'use strict';

/* jshint browser: true */
/* global console, $ */
/* global drawPoint, drawLine, drawCircle, drawArc, getModek, getMapStartX, getMapStartY */
/* global getPointX, getPointY, getMapEndX, getMapEndY, getMouseX, getMouseY */
/* global getZoomlessRatio, verticalDistance, getPlayer, screenToGameX, screenToGameY */
/* global getX, getY, getMemoryCells, getCells, getMode, getLastUpdate */



/*The MIT License (MIT)

Copyright (c) 2015 Apostolique

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.*/

// ==UserScript==
// @name        AposBot
// @namespace   AposBot
// @include     http://agar.io/*
// @version     3.1027
// @grant       none
// @author      http://www.twitch.tv/apostolique
// ==/UserScript==

var aposBotVersion = 3.1027;

var constants = {
    splitRangeMin: 650,
    splitRangeMax: 674.5,
    enemySplitDistance: 710,
    playerRatio: 1.285,
    enemyRatio: 1.27,

    // adjustables
	safeDistance: 150,
    lureDistance: 1100,
    largeThreatRatio: 10,

	red: 0,
    green: 1,
    blue: 2,
    orange: 3,
    purple: 4,
    pink: 5,
    cyan: 6,
    gray: 7,
    black: 8,
};

var Classification = {
	unknown: 0,
	virus: 1,
	food: 2,
	noThreat: 3,
	smallThreat: 4,
	largeThreat: 5,
	mergeTarget: 6,
	splitTarget: 7,
	player: 8,
	cluster: 9
};

//TODO: Team mode
//      Detect when people are merging
//      Angle based cluster code
//      Better wall code
//      In team mode, make allies be obstacles.

/*
Number.prototype.mod = function(n) {
    return ((this % n) + n) % n;
};
*/

var Player = function() {
	this.cells = [];
	this.isAlive = true;
	this.isReviving = false;
	this.isSplitting = false;
	this.isLuring = false;

    this.food = [];
    this.threats = [];
    this.viruses = [];

    this.chasing = 0;
    this.splitVelocity = 0;
    this.splitLocation = null;
    this.fuseTimer = null;
};

Player.prototype.setCells = function(cells) {
	this.cells = cells;
	this.isAlive = this.cells.length > 0;
	this.mass = 0;
    this.smallestCell = cells[0];
    this.largestCell = cells[0];
    
	for (var i = 0; i < cells.length; i++) {
		var cell = cells[i];
		
	    cell.mass = cell.size * cell.size / 100;

	    this.mass = this.mass + cell.mass;

    	if (cell.size < this.smallestCell.size) {
    		this.smallestCell = cell;
    	}
    	if (cell.size > this.largestCell.size) {
    		this.largestCell = cell;
    	}
    	
    	if (cells.length > 0) {
    		if (!cell.fuseTimer) {
    			cell.fuseTimer = Date.now() + (30 + cell.mass * 0.02) * 1000;
    		}
    	} else {
    		cell.fuseTimer = null;
    	}
	}

	if (cells.length > 0) {
		
		var enclosingCell = cells[0];
		
		if (cells.length > 1) {
			enclosingCell = enclosingCircle(cells);
		}
		this.size = enclosingCell.size;
		this.x = enclosingCell.x;
		this.y = enclosingCell.y;
	}
};

console.log("Apos Bot!");

window.botList = window.botList || [];

function AposBot() {
    this.name = "AposBot " + aposBotVersion;

    this.toggleFollow = false;
    this.infoStrings = [];
    this.previousUpdated = Date.now();
    this.keyAction = function(key) {
        if (81 == key.keyCode) {
            console.log("Toggle Follow Mouse!");
            this.toggleFollow = !this.toggleFollow;
        }
    };
    
    this.player = new Player();

    this.separateListBasedOnFunction = function(player, listToUse) {
        var mergeList = [];
        var i;
        var closestInfo;

    	player.safeToSplit = player.cells.length == 1;
        player.food = [];
        player.threats = [];
        player.viruses = [];

    	var that = this;
        Object.keys(listToUse).forEach(function(element, index) {

        	var entity = listToUse[element];
            var isMe = that.isItMe(player, entity);
            var isEnemy = true;

            entity.hasMoved = entity.isMoving();

            if (isMe) {
            	entity.classification = Classification.player;
                drawPoint(entity.x, entity.y+20, 1, "m:" + that.getMass(entity).toFixed(2) + " s:" + that.getSplitMass(entity).toFixed(2));
            } else {
            	
            	entity.isMovingTowards = that.isMovingTowards(player, entity);
            	entity.mass = that.calculateMass(entity);
            	closestInfo = that.closestCell(player, entity.x, entity.y);

            	entity.closestCell = closestInfo.cell;
                entity.distance = closestInfo.distance;

                /* danger types */
                entity.classification = Classification.unknown;

                if (that.isFood(player.smallestCell, entity)) {
                    //IT'S FOOD!
               		player.food.push(entity);
               		entity.classification = Classification.food;
                } else if (entity.isVirus(entity)) {
                    //IT'S VIRUS!
               		entity.classification = Classification.virus;
                    player.viruses.push(entity);
                } else if (that.canSplitKill(entity, player.smallestCell, constants.enemyRatio)) {
                	
                	entity.classification = Classification.largeThreat;
                	if (entity.mass / player.mass > 10) {    // should be constant
                    	entity.classification = Classification.smallThreat;
                	}
                    player.threats.push(entity);
                    mergeList.push(entity);
                } else if (that.canEat(entity, player.smallestCell, constants.enemyRatio)) {
                    //IT'S DANGER!
                	entity.classification = Classification.smallThreat;
                    player.threats.push(entity);
                    mergeList.push(entity);
                    
                //} else if (that.isThreatIfSplit(blob, entity)) {
                //	threatIfSplitList.push()
                } else if (!entity.hasMoved) {
                   	entity.classification = Classification.food;
                   	player.food.push(entity);
                    mergeList.push(entity);
                }
                else if (entity.closestCell.mass > 36 && that.canSplitKill(entity.closestCell, entity, constants.playerRatio)) {

                	if (player.cells.length == 1 && player.mass / entity.mass < constants.largeThreatRatio) {  // should be constant
                    	// split worthy
                    	entity.classification = Classification.splitTarget;
                	} else {
                		// too small
                		entity.classification = Classification.food;
                	}

                	player.food.push(entity);
                    mergeList.push(entity);
                }
                else if (that.canEat(player.smallestCell, entity, constants.playerRatio)) {

                   	entity.classification = Classification.food;
                	
                	player.food.push(entity);
                    mergeList.push(entity);
                	
                } else if (!that.canEat(entity, player.smallestCell, constants.enemeyRatio)) {
            		if (player.cells.length > 1 && player.mass / entity.mass < 10) {  // ?? mass check ?
                        player.food.push(entity);
                       	entity.classification = Classification.mergeTarget;
            		} else {
            			entity.classification = Classification.noThreat;
            		}
                    mergeList.push(entity);
            	}

                if (entity.classification == Classification.unknown) {
            		console.log('unknown');
            		console.log(entity);
            	}

                if (!entity.isVirus() && entity.size > 14) {

                	if (entity.closestCell.size * entity.closestCell.size / 2 < entity.size * entity.size * 1.265) {
                		if (entity.distance < 750 + entity.closestCell.size) {
                    		player.safeToSplit = false;
                		}
                	}
                }
            }
        });

        // increase virus mass if food is within
        for (i = player.food.length - 1; i >= 0; i--) {
        	this.foodInVirus(player, player.food[i], player.viruses);
        }
        
        //console.log("Merglist length: " +  mergeList.length)
        //cell merging
        for (i = 0; i < mergeList.length; i++) {
            for (var z = i+1; z < mergeList.length; z++) {
                if (this.isMerging(mergeList[i], mergeList[z]) &&
                		(mergeList[i].mass + mergeList[z].mass) / player.smallestCell.mass > constants.enemyRatio) {
                	//found cells that appear to be merging - if they constitute a threat add them to the threatlist

                    //clone us a new cell
                    var newThreat = {};
                    var prop;

                    for (prop in mergeList[i]) {
                        newThreat[prop] = mergeList[i][prop];
                    }

                    newThreat.x = (mergeList[i].x + mergeList[z].x)/2;
                    newThreat.y = (mergeList[i].y + mergeList[z].y)/2;
                    newThreat.mass = mergeList[i].mass + mergeList[z].mass;
                    newThreat.size = Math.sqrt(newThreat.mass * 100);
                    newThreat.isMovingTowards = true;
                    closestInfo = this.closestCell(player, newThreat.x, newThreat.y);

                	newThreat.closestCell = closestInfo.cell;
                	newThreat.distance = closestInfo.distance;

                	player.threats.push(newThreat);
                    newThreat.classification = Classification.smallThreat;
                	if (this.canSplitKill(newThreat, player.smallestCell, constants.enemyRatio)) {
                    	if (newThreat.mass / player.mass >= constants.largeThreatRatio) {
                			newThreat.classification = Classification.largeThreat;
                		}
                	}
                }
            }
        }
    };

    this.predictPosition = function(cell, timeDiff) {
		var lastPos = cell.getLastPos();

        var a = (getLastUpdate() - this.previousUpdated) / 120;
        a = 0 > a ? 0 : 1 < a ? 1 : a;

        timeDiff = timeDiff / 60;

        cell.px = timeDiff * a * (cell.J - cell.s) + cell.x;
        cell.py = timeDiff * a * (cell.K - cell.t) + cell.y;
    };
    
    this.interceptPosition = function(player, enemy) {
    	
    	var lastPos = enemy.getLastPos();

    	var timeDiff = getLastUpdate() - this.previousUpdated;

        var xdis = enemy.x - lastPos.x; // <--- FAKE AmS OF COURSE!
        var ydis = enemy.y - lastPos.y;

    	var bulletSpeed = 100;
    	var vx = Math.sqrt(xdis * xdis) / timeDiff;
    	var vy = Math.sqrt(ydis * ydis) / timeDiff;
    	
    	/* Relative player position */
    	var dx = player.x - enemy.x;
    	var dy = player.y - enemy.y;
    	/* Relative player velocity */

    	var a = vx * vx + vy * vy - bulletSpeed * bulletSpeed;
    	var b = 2 * (vx * dx + vy * dy);
    	var c = dx * dx + dy * dy;
    	var disc = b * b - 4 * a * c;

    	if (disc >= 0)
    	{
    	    var t0 = (-b - Math.sqrt(disc)) / (2 * a);
    	    var t1 = (-b + Math.sqrt(disc)) / (2 * a);
    	    /* If t0 is negative, or t1 is a better solution, use t1 */
    	    if (t0 < 0 || (t1 < t0 && t1 >= 0))
    	        t0 = t1;
    	    if (t0 >= 0)
    	    {
    	        /* Compute the ship's heading */
    	        var shootx = vx + dx / t0;
    	        var shooty = vy + dy / t0;
    	    	return [ enemy.x - shootx, enemy.y - shooty ];
    	    }
    	}
    	return [];
    };
    
    this.clusterFood = function(player, blobSize) {
        var clusters = [];
        var addedCluster = false;

        for (var i = 0; i < player.food.length; i++) {
        	
        	var food = player.food[i];
        	var foodSize = food.size;
        	
        	if (food.size <= 14) {
        		foodSize = food.size-9;
        	}

        	if (food.hasMoved && food.distance < 850) {

            	this.predictPosition(food, 800);

            	// really should clone da
                clusters.push({
                	x: food.px, 
                	y: food.py, 
                	size: food.size, 
                	cell: food, 
                	classification: Classification.cluster
                });
        	} else {
	            for (var j = 0; j < clusters.length; j++) {
	            	if (!clusters[j].cell) {
		                if (this.computeInexpensiveDistance(food.x, food.y, clusters[j].x, clusters[j].y) < blobSize * 2) {
		                	
		                    clusters[j].x = (food.x + clusters[j].x) / 2;
		                    clusters[j].y = (food.y + clusters[j].y) / 2;
		                    clusters[j].size += foodSize;
		                    addedCluster = true;
		                    break;
		                }
	            	}
	            }
	            if (!addedCluster) {
	                clusters.push({
	                	x: food.x, 
	                	y: food.y, 
	                	size: foodSize, 
	                	cell: null,
	                	classification: Classification.cluster
	                });
	            }
        	}
            addedCluster = false;
        }
        
        return clusters;
    };
    
    this.getBestFood = function(player) {
    	
    	var i;
    	
        for (i = 0; i < player.foodClusters.length; i++) {
        	
            //This is the cost function. Higher is better.

        	var cluster = player.foodClusters[i];
        	var multiplier = 3;

        	var closestInfo = this.closestCell(player, cluster.x, cluster.y);
            cluster.closestCell = closestInfo.cell;
            cluster.distance = closestInfo.distance;

            // if (!cluster.cell) {  // lets try not to follow enemies towards wall
            	if ((cluster.x < getMapStartX()+2000 && cluster.x < player.x) ||
            		(cluster.y < getMapStartY()+2000 && cluster.y < player.y) ||
            		(cluster.x > getMapEndX()-2000 && cluster.x > player.x) ||
            		(cluster.y > getMapEndY()-2000 && cluster.y > player.y)) {
            		
            		// everything close to the wall will seem very far away
            		multiplier = 25;
            	}
            // }

            var weight = cluster.size;
            if (cluster.cell) {
            	
            	if ((player.cells.length == 1) &&
            			this.isType(cluster.cell, Classification.splitTarget) ||
            			this.isType(cluster.cell, Classification.mergeTarget)) {
            		weight = weight * 2.5;
            	}

            	if (!cluster.cell.hasMoved) {
                	// easy food
            		weight = weight * 25;
            	} else if (player.safeToSplit && 
            			this.isType(cluster.cell, Classification.splitTarget) &&
            			this.inSplitRange(cluster.cell)) {
            		weight = weight * 3;
            		cluster.canSplitKill = true;
                }
            	if (cluster.cell.isMovingTowards) {
                	// prioritize enemies moving towards us
            		weight = weight * 1.2;
                }
            	
               	weight *= Math.log(closestInfo.distance / 1000 * 20);
            }
            cluster.clusterWeight = closestInfo.distance / weight * multiplier ;
            
            // drawPoint(cluster.x, cluster.y+60, 1, "" + parseInt(cluster.clusterWeight, 10) + " " + parseInt(cluster.size, 10));
        }
        
        var bestFoodI = 0;
        var bestClusterWeight = player.foodClusters[0].clusterWeight;
        for (i = 1; i < player.foodClusters.length; i++) {
            if (player.foodClusters[i].clusterWeight < bestClusterWeight) {
                bestClusterWeight = player.foodClusters[i].clusterWeight;
                bestFoodI = i;
            }
        }
        return player.foodClusters[bestFoodI];
    };
    
    this.determineDestination = function(player, tempPoint) {
    	
        //The bot works by removing angles in which it is too
        //dangerous to travel towards to.
        var badAngles = [];
        var obstacleList = [];
        var tempMoveX = getPointX();
        var tempMoveY = getPointY();
        var i, j, angle1, angle2, tempOb, line1, line2, diff, threat, shiftedAngle, destination, closestCell;
        var destinationChoices, cluster;
        var panicMode = false;

        for (j = 0; j < player.cells.length; j++) {
            for (i = 0; i < player.threats.length; i++) {
            	if (this.circlesIntersect(player.cells[j], player.threats[i])) {
            		panicMode = true;
            		break;
            	}
            }
        }

        for (i = 0; i < player.threats.length; i++) {
        	
        	threat = player.threats[i];

            closestCell = threat.closestCell;
            var enemyDistance = threat.distance;

            var enemyCanSplit = this.isType(threat, Classification.largeThreat);
            
            if (panicMode) {
            	console.log('panic mode');
            	enemyCanSplit = false;
            	
            	// save the biggest cell
//            	closestCell = player.largestCell;
            }

            var normalDangerDistance = threat.size + constants.safeDistance;
            var shiftDistance = player.size;
            var splitDangerDistance = threat.size + constants.enemySplitDistance + constants.safeDistance;
            var secureDistance = (enemyCanSplit ? splitDangerDistance : normalDangerDistance);
            
            threat.dangerZone = secureDistance;

            for (j = player.foodClusters.length - 1; j >= 0 ; j--) {
            	cluster = player.foodClusters[j];
                if (this.computeDistance(threat.x, threat.y, player.foodClusters[j].x, player.foodClusters[j].y) < 
                		secureDistance + shiftDistance) {
                    player.foodClusters.splice(j, 1);
                }
            }

            if (panicMode || threat.danger && getLastUpdate() - threat.dangerTimeOut > 1500) {

                threat.danger = false;
            }

            if (!panicMode) {
            	
	            if ((enemyCanSplit && enemyDistance < splitDangerDistance) ||
	                (!enemyCanSplit && enemyDistance < normalDangerDistance)) {
	
	                // threat.danger = true;
	                threat.dangerTimeOut = getLastUpdate();
	            }
            }

            //console.log("Figured out who was important.");
            
            if ((enemyCanSplit && enemyDistance < splitDangerDistance) || (enemyCanSplit && threat.danger)) {

                badAngles.push(this.getAngleRange(closestCell, threat, i, splitDangerDistance).concat(threat.distance));

            } else if ((!enemyCanSplit && enemyDistance < normalDangerDistance) || (!enemyCanSplit && threat.danger)) {

                badAngles.push(this.getAngleRange(closestCell, threat, i, normalDangerDistance).concat(threat.distance));

            } else if (enemyCanSplit && enemyDistance < splitDangerDistance + shiftDistance) {
                tempOb = this.getAngleRange(closestCell, threat, i, splitDangerDistance + shiftDistance);
                angle1 = tempOb[0];
                angle2 = this.rangeToAngle(tempOb);

                obstacleList.push([[angle1, true], [angle2, false]]);
            } else if (!enemyCanSplit && enemyDistance < normalDangerDistance + shiftDistance) {
                tempOb = this.getAngleRange(closestCell, threat, i, normalDangerDistance + shiftDistance);
                angle1 = tempOb[0];
                angle2 = this.rangeToAngle(tempOb);

                obstacleList.push([[angle1, true], [angle2, false]]);
            }
        }

		for (i = 0; i < player.viruses.length; i++) {
			var virus = player.viruses[i];
			
			for (j = 0; j < player.cells.length; j++) {
				var cell = player.cells[j];

	            if (virus.distance < cell.size + 750 && cell.mass > virus.mass) {
	                tempOb = this.getAngleRange(cell, virus, i, normalDangerDistance + virus.size / 2); // was 50
	                angle1 = tempOb[0];
	                angle2 = this.rangeToAngle(tempOb);
	                obstacleList.push([[angle1, true], [angle2, false]]);
	            	// drawCircle(virus.x, virus.y, virus.size + 5, constants.red);
	            }
			}
        }
		/*
		 * original - if after splitting, a virus is inside the enclosing player, the player can hit the virus
		for (i = 0; i < player.viruses.length; i++) {
            var virusDistance = this.computeDistance(player.viruses[i].x, player.viruses[i].y, player.x, player.y);
            if (player.largestCell.size < player.viruses[i].size) {
                if (virusDistance < (player.viruses[i].size * 2)) {
                    tempOb = this.getAngleRange(player, player.viruses[i], i, player.viruses[i].size + 10);
                    angle1 = tempOb[0];
                    angle2 = this.rangeToAngle(tempOb);
                    obstacleList.push([[angle1, true], [angle2, false]]);
                }
            } else {
                if (virusDistance < (player.size * 2)) {
                    tempOb = this.getAngleRange(player, player.viruses[i], i, player.size + 50);
                    angle1 = tempOb[0];
                    angle2 = this.rangeToAngle(tempOb);
                    obstacleList.push([[angle1, true], [angle2, false]]);
                }
            }
        }
		 */

        var stupidList = [];

        if (badAngles.length > 0) {
            //NOTE: This is only bandaid wall code. It's not the best way to do it.
            stupidList = this.addWall(stupidList, player);
        }

        for (i = 0; i < badAngles.length; i++) {
            angle1 = badAngles[i][0];
            angle2 = this.rangeToAngle(badAngles[i]);
            stupidList.push([[angle1, true], [angle2, false], badAngles[i][2]]);
        }

        //stupidList.push([[45, true], [135, false]]);
        //stupidList.push([[10, true], [200, false]]);

        stupidList.sort(function(a, b){
            return a[2]-b[2];
        });

        var sortedInterList = [];
        var sortedObList = [];

        for (i = 0; i < stupidList.length; i++) {

            var tempList = this.addAngle(sortedInterList, stupidList[i]);

            if (tempList.length === 0) {
                console.log("MAYDAY IT'S HAPPENING!");

                break;
            } else {
                sortedInterList = tempList;
            }
        }

        for (i = 0; i < obstacleList.length; i++) {
            sortedObList = this.addAngle(sortedObList, obstacleList[i]);

            if (sortedObList.length === 0) {
                break;
            }
        }

        var offsetI = 0;
        var obOffsetI = 1;

        if (sortedInterList.length > 0 && sortedInterList[0][1]) {
            offsetI = 1;
        }
        if (sortedObList.length > 0 && sortedObList[0][1]) {
            obOffsetI = 0;
        }

        var goodAngles = [];
        var obstacleAngles = [];

        for (i = 0; i < sortedInterList.length; i += 2) {
            angle1 = sortedInterList[this.mod(i + offsetI, sortedInterList.length)][0];
            angle2 = sortedInterList[this.mod(i + 1 + offsetI, sortedInterList.length)][0];
            diff = this.mod(angle2 - angle1, 360);
            goodAngles.push([angle1, diff]);
        }

        for (i = 0; i < sortedObList.length; i += 2) {
            angle1 = sortedObList[this.mod(i + obOffsetI, sortedObList.length)][0];
            angle2 = sortedObList[this.mod(i + 1 + obOffsetI, sortedObList.length)][0];
            diff = this.mod(angle2 - angle1, 360);
            obstacleAngles.push([angle1, diff]);
        }

        for (i = 0; i < goodAngles.length; i++) {
            
            line1 = this.followAngle(goodAngles[i][0], player.x, player.y, 100 + player.size);            
            line2 = this.followAngle(this.mod(goodAngles[i][0] + goodAngles[i][1], 360), player.x, player.y, 100 + player.size);
            drawLine(player.x, player.y, line1[0], line1[1], 1);
            drawLine(player.x, player.y, line2[0], line2[1], 1);
            drawArc(line1[0], line1[1], line2[0], line2[1], player.x, player.y, 1);

            //drawPoint(player[0].x, player[0].y, 2, "");

            drawPoint(line1[0], line1[1], 0, "" + i + ": 0");
            drawPoint(line2[0], line2[1], 0, "" + i + ": 1");
        }

        for (i = 0; i < obstacleAngles.length; i++) {

        	this.drawAngle(player, obstacleAngles[i], 50, 6);
        }

        if (this.toggleFollow && goodAngles.length === 0) {
            //This is the follow the mouse mode
            var distance = this.computeDistance(player.x, player.y, tempPoint[0], tempPoint[1]);

            shiftedAngle = this.shiftAngle(obstacleAngles, this.getAngle(tempPoint[0], tempPoint[1], player.x, player.y), [0, 360]);

            destination = this.followAngle(shiftedAngle, player.x, player.y, distance);

            destinationChoices = destination;
            drawLine(player.x, player.y, destination[0], destination[1], 1);
            //tempMoveX = destination[0];
            //tempMoveY = destination[1];

        } else if (goodAngles.length > 0) {
            var bIndex = goodAngles[0];
            var biggest = goodAngles[0][1];
            for (i = 1; i < goodAngles.length; i++) {
                var size = goodAngles[i][1];
                if (size > biggest) {
                    biggest = size;
                    bIndex = goodAngles[i];
                }
            }
            var perfectAngle = this.mod(bIndex[0] + bIndex[1] / 2, 360);

            perfectAngle = this.shiftAngle(obstacleAngles, perfectAngle, bIndex);

            line1 = this.followAngle(perfectAngle, player.x, player.y, verticalDistance());

            destinationChoices = line1;
            drawLine(player.x, player.y, line1[0], line1[1], 7);
            //tempMoveX = line1[0];
            //tempMoveY = line1[1];
        } else if (badAngles.length > 0 && goodAngles.length === 0) {
            //When there are enemies around but no good angles
            //You're likely screwed. (This should never happen.)

            console.log("Failed");
            destinationChoices = [tempMoveX, tempMoveY];
            /*var angleWeights = [] //Put weights on the angles according to enemy distance
            for (var i = 0; i < player.threats.length; i++){
                var dist = this.computeDistance(player.x, player.y, player.threats[i].x, player.threats[i].y);
                var angle = this.getAngle(player.threats[i].x, player.threats[i].y, player.x, player.y);
                angleWeights.push([angle,dist]);
            }
            var maxDist = 0;
            var finalAngle = 0;
            for (var i = 0; i < angleWeights.length; i++){
                if (angleWeights[i][1] > maxDist){
                    maxDist = angleWeights[i][1];
                    finalAngle = this.mod(angleWeights[i][0] + 180, 360);
                }
            }
            line1 = this.followAngle(finalAngle,player.x,player.y,f.verticalDistance());
            drawLine(player.x, player.y, line1[0], line1[1], 2);
            destinationChoices.push(line1);*/
        } else if (player.foodClusters.length > 0) {
        	
        	var doSplit = player.largestCell.mass >= 36 && player.mass <= 50 && player.cells.length == 1 && player.safeToSplit;
        	var doLure = false;

        	cluster = this.getBestFood(player);
	    			
        	drawCircle(cluster.x, cluster.y, cluster.size + 30, constants.orange);

            // drawPoint(bestFood.x, bestFood.y, 1, "");
            if (cluster.canSplitKill && player.safeToSplit) {
                
                doSplit = true;
            }
            
            if (cluster.cell) {
            	
	            tempOb = this.getAngleRange(cluster.closestCell, cluster, 1, cluster.cell.size);
	            angle1 = tempOb[0];
	            angle2 = this.rangeToAngle(tempOb);
	            diff = this.mod(angle2 - angle1, 360);
	            
	        	//this.drawAngle(cluster.closestCell, [angle1, diff], 50, constants.green);
            }

            var angle = this.getAngle(cluster.x, cluster.y, cluster.closestCell.x, cluster.closestCell.y);

            shiftedAngle = this.shiftAngle(obstacleAngles, angle, [0, 360]);

            destination = this.followAngle(shiftedAngle, cluster.closestCell.x, cluster.closestCell.y, cluster.distance);

            // really bad condition logic - but check if it's a split target just outside of range
            if (!doSplit && 
            		!player.isLuring && 
            		obstacleAngles.length === 0 && 
            		player.safeToSplit && 
            		cluster.cell && 
            		this.isType(cluster.cell, Classification.splitTarget) &&
            		!cluster.cell.isMovingTowards && 
        			cluster.distance < constants.lureDistance &&
        			cluster.distance > constants.splitRangeMax && // not already in range (might have been an enemy close)
        			player.mass > 250 && 
        			(player.mass - cluster.cell.mass > 25)) {

            	// TODO: figure out lure amount
            	player.isLuring = true;
            	doLure = true;
                setTimeout(function() {
                	player.isLuring = false;
                }, 5000);
            }

            // are we avoiding obstacles ??
            if (doSplit && obstacleAngles.length === 0) {
				player.isSplitting = true;
            	player.splitTarget = cluster.cell;
            	player.splitSize = player.size;
            	
        		player.splitTimer = Date.now();
        		player.splitLocation = { 
        				x: player.largestCell.x + (cluster.x - player.largestCell.x) * 4,
        				y: player.largestCell.y + (cluster.y - player.largestCell.y) * 4,
        				startx: player.largestCell.x,
        				starty: player.largestCell.y
        		};
        		
        		destination[0] = player.splitLocation.x;
        		destination[1] = player.splitLocation.y;        		
        		
        		player.splitDistance = 0;

            } else {
                
                doSplit = false;
            }
            
            destinationChoices = [ destination[0], destination[1], doSplit, doLure ];

            drawLine(cluster.closestCell.x, cluster.closestCell.y, destination[0], destination[1], 1);
        } else {
            //If there are no enemies around and no food to eat.
            destinationChoices = [tempMoveX, tempMoveY];
        }

        return destinationChoices;
    };

    /**
     * This is the main bot logic. This is called quite often.
     * @return A 2 dimensional array with coordinates for every cells.  [[x, y], [x, y]]
     */
    this.mainLoop = function(cells) {
        var player = this.player;
        var listToUse = getMemoryCells();
        var i;
        
        player.setCells(cells);

        if (player.cells.length > 1) {
//        	console.log('cell ' + player.cells[1].id);
        }
        
        var useMouseX = screenToGameX(getMouseX());
        var useMouseY = screenToGameY(getMouseY());
        var tempPoint = [useMouseX, useMouseY, 1];

        //The current destination that the cells were going towards.

        drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX() + (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), 7);
        drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), getX() + (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), 7);
        drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX() - (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), 7);
        drawLine(getX() + (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX() + (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), 7);

    	if (player.isSplitting && player.cells.length > 1) {
    		var distance = this.computeDistance(player.cells[0].x, player.cells[0].y, 
    				player.cells[1].x, player.cells[1].y);
    		if (distance > player.splitDistance) {
    			
        		var lastPos = player.cells[1].getLastPos();

        		var cellDistance = this.computeDistance(player.cells[1].x, player.cells[1].y, 
        				lastPos.x, lastPos.y);

    			player.splitDistance = distance;
    			var timeDiff = getLastUpdate() - this.previousUpdated;
    			player.splitVelocity = cellDistance / timeDiff;

    			//console.log([ player.splitVelocity, cellDistance, timeDiff, player.cells[1].x, player.cells[1].y, 
    	        //				lastPos.x, lastPos.y ]);
    		}
    	}
    	
    	if (player.isSplitting) {
    		
    		if (player.size <= player.splitSize && (Date.now() - player.splitTimer > 200)) {
    			// player size grows as long as we are splitting
            	player.isSplitting = false;
            	player.splitTarget = null;
    		} else {
            	player.splitSize = player.size;
        		
                drawCircle(player.splitLocation.x, player.splitLocation.y, 50, constants.green);
        		if (player.splitTarget) {
            		return [ player.splitTarget.x, player.splitTarget.y ];
        		}
        		return [ getPointX(), getPointY() ];
    		}
    	}

    	if (player.cells.length > 1) {
            drawCircle(player.x, player.y, player.size, 6);
    	}
    	
    	if (player.safeToSplit) {
        	drawCircle(player.x, player.y, player.size + 16, constants.green);
    	}

    	drawCircle(player.x, player.y, player.size + constants.enemySplitDistance, 5);
    	
        // drawLine(player.x, player.y, player.x, player.y + player.size + this.splitDistance, 7);
        //drawPoint(player[0].x, player[0].y - player[0].size, 3, "" + Math.floor(player[0].x) + ", " + Math.floor(player[0].y));

        //loop through everything that is on the screen and
        //separate everything in it's own category.
    	
        this.separateListBasedOnFunction(player, listToUse);

        player.foodClusters = this.clusterFood(player, player.largestCell.size);

        /*player.threats.sort(function(a, b){
            return a.distance-b.distance;
        })*/

        var destinationChoices = this.determineDestination(player, tempPoint);

        Object.keys(listToUse).forEach(function(element, index) {

        	var entity = listToUse[element];
        	
        	switch (entity.classification) {
	            case Classification.virus:
	                if (player.largestCell.size < entity.size) {
	                    // drawCircle(entity.x, entity.y, entity.size + 10, 3);
	                    drawCircle(entity.x, entity.y, entity.size * 2, 6);
	
	                } else {
	                    drawCircle(entity.x, entity.y, player.largestCell.size + 50, 3);
	                    drawCircle(entity.x, entity.y, player.largestCell.size * 2, 6);
	                }
                break;
	            case Classification.splitTarget:
	            	drawCircle(entity.x, entity.y, entity.size + 20, constants.green);
	            break;
	            case Classification.mergeTarget:
	            	drawCircle(entity.x, entity.y, entity.size + 20, constants.cyan);
	            break;
	            case Classification.food:
		            drawPoint(entity.x, entity.y+20, 1, "m:" + entity.mass.toFixed(2));
	            	if (entity.hasMoved) {
		            	drawCircle(entity.x, entity.y, entity.size + 20, constants.gray);
	            	} else if (entity.size > 14) {
    	            	drawCircle(entity.x, entity.y, entity.size + 20, constants.cyan);
        			}
	            break;
	            case Classification.unknown:
	            	drawCircle(entity.x, entity.y, entity.size + 20, constants.cyan);
	            break;
        	}
        });

        for (i = 0; i < player.threats.length; i++) {

        	var entity = player.threats[i];
        	
        	switch (entity.classification) {
		        case Classification.smallThreat:
		        case Classification.largeThreat:
		            drawPoint(entity.x, entity.y+20, 1, "m:" + this.getMass(entity).toFixed(2) + " s:" + this.getSplitMass(entity).toFixed(2));
		            if (this.isType(entity, Classification.largeThreat)) {
		                drawPoint(entity.x, entity.y+40, 1, "c:" + (this.getSplitMass(entity) / this.getMass(entity)).toFixed(2));
		            }
		        	drawCircle(entity.x, entity.y, entity.size + 20, 0);
		            drawCircle(entity.x, entity.y, entity.dangerZone, 0);
		        	if (entity.isMovingTowards) {
		            	drawCircle(entity.x, entity.y, entity.size + 40, 3);
		        	}
		        break;
        	}
        }
        
        // drawPoint(tempPoint[0], tempPoint[1], tempPoint[2], "what ?");
        //console.log("Slope: " + slope(tempPoint[0], tempPoint[1], player[0].x, player[0].y) + " Angle: " + getAngle(tempPoint[0], tempPoint[1], player[0].x, player[0].y) + " Side: " + this.mod(getAngle(tempPoint[0], tempPoint[1], player[0].x, player[0].y) - 90, 360));
        tempPoint[2] = 1;

        this.infoStrings = [];
        this.infoStrings.push("Player Mass: " + parseInt(player.mass, 10));
        if (player.cells.length > 1) {
	        this.infoStrings.push("Player Min:  " + parseInt(player.smallestCell.size, 10));
	        this.infoStrings.push("Player Max:  " + parseInt(player.largestCell.size, 10));
        }
        this.infoStrings.push("Food:        " + player.food.length);
        this.infoStrings.push("Threats:     " + player.threats.length);
        this.infoStrings.push("Viruses:     " + player.viruses.length);

        for (i = 0; i < player.cells.length; i++) {

        	var cell = player.cells[i];
        	var cellInfo = "Cell " + i + " Mass: " + parseInt(cell.size, 10);
        	if (cell.fuseTimer) {
        		cellInfo += " Fuse: " + parseInt((cell.fuseTimer - Date.now()) / 1000, 10);
        	}
            this.infoStrings.push(cellInfo);
        }

        this.infoStrings.push("");

        this.previousUpdated = getLastUpdate();
        
        return destinationChoices;
    };

    
    
    
    
    
    
    
    
    this.isType = function(entity, classification) {
    	return entity.classification == classification;
    };

    this.displayText = function() {
    	var debugStrings = ["Q - Follow Mouse: " + (this.toggleFollow ? "On" : "Off")];
    	for (var i = 0; i < this.infoStrings.length; i++) {
    		debugStrings.push(this.infoStrings[i]);
    	}
        return debugStrings;
    };

    // Using mod function instead the prototype directly as it is very slow
    this.mod = function(num, mod) {
        if (mod & (mod - 1) === 0 && mod !== 0) {
            return num & (mod - 1);
        }
        return num < 0 ? ((num % mod) + mod) % mod : num % mod;
    };

    this.isMerging = function(cell1, cell2) {        
        var dist = this.computeDistance(cell1.x, cell1.y, cell2.x, cell2.y, cell1.size, cell2.size);
        
        //debug logging
        if (false){
	        var params = [cell1.x, cell1.y, cell2.x, cell2.y, cell1.size, cell2.size, dist];
	        var debugString = params.join(", ");
	        console.log("Merge:" + debugString);
        }
        
        return dist <= -50;
    };

    //Given an angle value that was gotten from valueAndleBased(),
    //returns a new value that scales it appropriately.
    this.paraAngleValue = function(angleValue, range) {
        return (15 / (range[1])) * (angleValue * angleValue) - (range[1] / 6);
    };

    this.valueAngleBased = function(angle, range) {
        var leftValue = this.mod(angle - range[0], 360);
        var rightValue = this.mod(this.rangeToAngle(range) - angle, 360);

        var bestValue = Math.min(leftValue, rightValue);

        if (bestValue <= range[1]) {
            return this.paraAngleValue(bestValue, range);
        }
        return -1;
    };

    this.computeDistance = function(x1, y1, x2, y2, s1, s2) {
        // Make sure there are no null optional params.
        s1 = s1 || 0;
        s2 = s2 || 0;
        var xdis = x1 - x2; // <--- FAKE AmS OF COURSE!
        var ydis = y1 - y2;
        var distance = Math.sqrt(xdis * xdis + ydis * ydis) - (s1 + s2);

        return distance;
    };

    // Get a distance that is Inexpensive on the cpu for various purpaces
    this.computeInexpensiveDistance = function(x1, y1, x2, y2, s1, s2) {
        // Make sure there are no null optional params.
        s1 = s1 || 0;
        s2 = s2 || 0;
        var xdis = x1 - x2;
        var ydis = y1 - y2;
        // Get abs quickly
        xdis = xdis < 0 ? xdis * -1 : xdis;
        ydis = ydis < 0 ? ydis * -1 : ydis;

        var distance = xdis + ydis;

        return distance;
    };

    this.compareSize = function(player1, player2, ratio) {
        if (player1.size * player1.size * ratio < player2.size * player2.size) {
            return true;
        }
        return false;
    };

    this.isItMe = function(player, cell) {
        if (getMode() == ":teams") {
            var currentColor = player.cells[0].color;
            var currentRed = currentColor.substring(1,3);
            var currentGreen = currentColor.substring(3,5);
            var currentBlue = currentColor.substring(5,7);
            
            var currentTeam = this.getTeam(currentRed, currentGreen, currentBlue);

            var cellColor = cell.color;

            var cellRed = cellColor.substring(1,3);
            var cellGreen = cellColor.substring(3,5);
            var cellBlue = cellColor.substring(5,7);

            var cellTeam = this.getTeam(cellRed, cellGreen, cellBlue);

            if (currentTeam == cellTeam && !cell.isVirus()) {
                return true;
            }

            //console.log("COLOR: " + color);

        } else {
            for (var i = 0; i < player.cells.length; i++) {
                if (cell.id == player.cells[i].id) {
                    return true;
                }
            }
        }
        return false;
    };

    this.getTeam = function(red, green, blue) {
        if (red == "ff") {
            return 0;
        } else if (green == "ff") {
            return 1;
        }
        return 2;
    };

    this.isFood = function(blob, cell) {

    	if (!cell.isMoving() && !cell.isVirus() && this.canEat(blob, cell, constants.playerRatio)) {
            return true;
        }
        return false;
    };

    this.calculateMass = function(cell) {
    	return cell.size * cell.size / 100;
    };

    this.getMass = function(cell) {
    	return cell.mass;
    };

    this.getSplitMass = function(cell) {
        return (cell.size * cell.size) / 2 / 100;
    };

    this.getRatio = function(eater, eatee) {
    	return this.getMass(eater) / this.getMass(eatee);
    };
    
    this.canEat = function(eater, eatee, ratio) {
    	if (eater.size > eatee.size) {
        	return this.getMass(eater) / this.getMass(eatee) > ratio;
    	}
    	return false;
    };

    // can i split and eat someone
    this.canSplitKill = function(eater, eatee, ratio) {

    	if (eater.size > eatee.size) {
    		return this.getSplitMass(eater) / this.getMass(eatee) > ratio;
    	}
    	return false;
    };

    this.isVirus = function(blob, cell) {
        if (blob === null) {
            if (cell.isVirus()){return true;} 
            else {return false;}
        }
        
        if (cell.isVirus() && blob.size > cell.size) {
            return true;
        } else if (cell.isVirus() && cell.color.substring(3,5).toLowerCase() != "ff") {
            return true;
        }
        return false;
    };

    this.getTimeToRemerge = function(mass){
        return ((mass*0.02) + 30);
    };
    
    this.circlesIntersect = function(circle1, circle2) {
        var distanceX = circle1.x - circle2.x;
        var distanceY = circle1.y - circle2.y;
        var radiusSum = circle1.size + circle2.size;
        return distanceX * distanceX + distanceY * distanceY <= radiusSum * radiusSum;
    };
    
    this.foodInVirus = function(player, food, viruses) {

    	for (var i = 0; i < viruses.length; i++) {
        	var virus = viruses[i];
        	if (this.circlesIntersect(food, virus)) {
        		virus.mass -= food.mass;
        		return true;
        	}
        }
        return false;
    };
    
    this.isMovingTowards = function(a, b) {

    	if (!b.hasMoved) {
    		return false;
    	}

    	var oldx = b.getLastPos().x;
    	var oldy = b.getLastPos().y;

    	return this.computeInexpensiveDistance(b.x, b.y, a.x, a.y) < this.computeInexpensiveDistance(oldx, oldy, a.x, a.y);
    };

    this.getAngle = function(x1, y1, x2, y2) {
        //Handle vertical and horizontal lines.

        if (x1 == x2) {
            if (y1 < y2) {
                return 271;
                //return 89;
            } else {
                return 89;
            }
        }

        return (Math.round(Math.atan2(-(y1 - y2), -(x1 - x2)) / Math.PI * 180 + 180));
    };

    this.slope = function(x1, y1, x2, y2) {
        var m = (y1 - y2) / (x1 - x2);

        return m;
    };

    this.slopeFromAngle = function(degree) {
        if (degree == 270) {
            degree = 271;
        } else if (degree == 90) {
            degree = 91;
        }
        return Math.tan((degree - 180) / 180 * Math.PI);
    };

    //Given two points on a line, finds the slope of a perpendicular line crossing it.
    this.inverseSlope = function(x1, y1, x2, y2) {
        var m = this.slope(x1, y1, x2, y2);
        return (-1) / m;
    };

    //Given a slope and an offset, returns two points on that line.
    this.pointsOnLine = function(slope, useX, useY, distance) {
        var b = useY - slope * useX;
        var r = Math.sqrt(1 + slope * slope);

        var newX1 = (useX + (distance / r));
        var newY1 = (useY + ((distance * slope) / r));
        var newX2 = (useX + ((-distance) / r));
        var newY2 = (useY + (((-distance) * slope) / r));

        return [
            [newX1, newY1],
            [newX2, newY2]
        ];
    };

	this.drawAngle = function(cell, angle, distance, color) {
        var line1 = this.followAngle(angle[0], cell.x, cell.y, distance + cell.size);
        var line2 = this.followAngle(this.mod(angle[0] + angle[1], 360), cell.x, cell.y, distance + cell.size);

        drawLine(cell.x, cell.y, line1[0], line1[1], color);
        drawLine(cell.x, cell.y, line2[0], line2[1], color);

        drawArc(line1[0], line1[1], line2[0], line2[1], cell.x, cell.y, color);

        //drawPoint(cell[0].x, cell[0].y, 2, "");

        drawPoint(line1[0], line1[1], 0, parseInt(angle[0], 10));
        drawPoint(line2[0], line2[1], 0, parseInt(angle[1], 10));
	};

    this.followAngle = function(angle, useX, useY, distance) {
        var slope = this.slopeFromAngle(angle);
        var coords = this.pointsOnLine(slope, useX, useY, distance);

        var side = this.mod(angle - 90, 360);
        if (side < 180) {
            return coords[1];
        } else {
            return coords[0];
        }
    };

    //Using a line formed from point a to b, tells if point c is on S side of that line.
    this.isSideLine = function(a, b, c) {
        if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) {
            return true;
        }
        return false;
    };

    //angle range2 is within angle range2
    //an Angle is a point and a distance between an other point [5, 40]
    this.angleRangeIsWithin = function(range1, range2) {
        if (range2[0] == this.mod(range2[0] + range2[1], 360)) {
            return true;
        }
        //console.log("r1: " + range1[0] + ", " + range1[1] + " ... r2: " + range2[0] + ", " + range2[1]);

        var distanceFrom0 = this.mod(range1[0] - range2[0], 360);
        var distanceFrom1 = this.mod(range1[1] - range2[0], 360);

        if (distanceFrom0 < range2[1] && distanceFrom1 < range2[1] && distanceFrom0 < distanceFrom1) {
            return true;
        }
        return false;
    };

    this.angleRangeIsWithinInverted = function(range1, range2) {
        var distanceFrom0 = this.mod(range1[0] - range2[0], 360);
        var distanceFrom1 = this.mod(range1[1] - range2[0], 360);

        if (distanceFrom0 < range2[1] && distanceFrom1 < range2[1] && distanceFrom0 > distanceFrom1) {
            return true;
        }
        return false;
    };

    this.angleIsWithin = function(angle, range) {
        var diff = this.mod(this.rangeToAngle(range) - angle, 360);
        if (diff >= 0 && diff <= range[1]) {
            return true;
        }
        return false;
    };

    this.rangeToAngle = function(range) {
        return this.mod(range[0] + range[1], 360);
    };

    this.anglePair = function(range) {
        return (range[0] + ", " + this.rangeToAngle(range) + " range: " + range[1]);
    };

    this.computeAngleRanges = function(blob1, blob2) {
        var mainAngle = this.getAngle(blob1.x, blob1.y, blob2.x, blob2.y);
        var leftAngle = this.mod(mainAngle - 90, 360);
        var rightAngle = this.mod(mainAngle + 90, 360);

        var blob1Left = this.followAngle(leftAngle, blob1.x, blob1.y, blob1.size);
        var blob1Right = this.followAngle(rightAngle, blob1.x, blob1.y, blob1.size);

        var blob2Left = this.followAngle(rightAngle, blob2.x, blob2.y, blob2.size);
        var blob2Right = this.followAngle(leftAngle, blob2.x, blob2.y, blob2.size);

        var blob1AngleLeft = this.getAngle(blob2.x, blob2.y, blob1Left[0], blob1Left[1]);
        var blob1AngleRight = this.getAngle(blob2.x, blob2.y, blob1Right[0], blob1Right[1]);

        var blob2AngleLeft = this.getAngle(blob1.x, blob1.y, blob2Left[0], blob2Left[1]);
        var blob2AngleRight = this.getAngle(blob1.x, blob1.y, blob2Right[0], blob2Right[1]);

        var blob1Range = this.mod(blob1AngleRight - blob1AngleLeft, 360);
        var blob2Range = this.mod(blob2AngleRight - blob2AngleLeft, 360);

        var tempLine = this.followAngle(blob2AngleLeft, blob2Left[0], blob2Left[1], 400);
        //drawLine(blob2Left[0], blob2Left[1], tempLine[0], tempLine[1], 0);

        if ((blob1Range / blob2Range) > 1) {
            drawPoint(blob1Left[0], blob1Left[1], 3, "");
            drawPoint(blob1Right[0], blob1Right[1], 3, "");
            drawPoint(blob1.x, blob1.y, 3, "" + blob1Range + ", " + blob2Range + " R: " + (Math.round((blob1Range / blob2Range) * 1000) / 1000));
        }

        //drawPoint(blob2.x, blob2.y, 3, "" + blob1Range);
    };

    /*
    this.debugAngle = function(angle, text) {
        var player = getPlayer();
        var cell = player.cells[0];
        var line1 = this.followAngle(angle, cell.x, cell.y, 300);
        drawLine(cell.x, cell.y, line1[0], line1[1], 5);
        drawPoint(line1[0], line1[1], 5, "" + text);
    };
    */

    //TODO: Don't let this function do the radius math.
    this.getEdgeLinesFromPoint = function(blob1, blob2, radius) {
        var px = blob1.x;
        var py = blob1.y;

        var cx = blob2.x;
        var cy = blob2.y;

        //var radius = blob2.size;

        /*if (blob2.isVirus()) {
            radius = blob1.size;
        } else if(canSplit(blob1, blob2)) {
            radius += splitDistance;
        } else {
            radius += blob1.size * 2;
        }*/

        var shouldInvert = false;

        var tempRadius = this.computeDistance(px, py, cx, cy);
        if (tempRadius <= radius) {
            radius = tempRadius - 5;
            shouldInvert = true;
        }

        var dx = cx - px;
        var dy = cy - py;
        var dd = Math.sqrt(dx * dx + dy * dy);
        var a = Math.asin(radius / dd);
        var b = Math.atan2(dy, dx);

        var t = b - a;
        var ta = {
            x: radius * Math.sin(t),
            y: radius * -Math.cos(t)
        };

        t = b + a;
        var tb = {
            x: radius * -Math.sin(t),
            y: radius * Math.cos(t)
        };

        var angleLeft = this.getAngle(cx + ta.x, cy + ta.y, px, py);
        var angleRight = this.getAngle(cx + tb.x, cy + tb.y, px, py);
        var angleDistance = this.mod(angleRight - angleLeft, 360);

        /*if (shouldInvert) {
            var temp = angleLeft;
            angleLeft = this.mod(angleRight + 180, 360);
            angleRight = this.mod(temp + 180, 360);
            angleDistance = this.mod(angleRight - angleLeft, 360);
        }*/

        return [angleLeft, angleDistance, [cx + tb.x, cy + tb.y],
            [cx + ta.x, cy + ta.y]
        ];
    };

    /*
    this.invertAngle = function(range) { // Where are you getting all of these vars from? (badAngles and angle)
        var angle1 = this.rangeToAngle(badAngles[i]);
        var angle2 = this.mod(badAngles[i][0] - angle, 360);
        return [angle1, angle2];
    },
    */

    this.addWall = function(listToUse, blob) {
    	
    	var lineLeft, lineRight;
        //var mapSizeX = Math.abs(f.getMapStartX - f.getMapEndX);
        //var mapSizeY = Math.abs(f.getMapStartY - f.getMapEndY);
        //var distanceFromWallX = mapSizeX/3;
        //var distanceFromWallY = mapSizeY/3;
        var distanceFromWallY = 1000;  // originally 2000
        var distanceFromWallX = 1000;  // originally 2000
        if (blob.x < getMapStartX() + distanceFromWallX) {
            //LEFT
            //console.log("Left");
            listToUse.push([
                [115, true],
                [245, false], this.computeInexpensiveDistance(getMapStartX(), blob.y, blob.x, blob.y)
            ]);
            lineLeft = this.followAngle(115, blob.x, blob.y, 190 + blob.size);
            lineRight = this.followAngle(245, blob.x, blob.y, 190 + blob.size);
            drawLine(blob.x, blob.y, lineLeft[0], lineLeft[1], 5);
            drawLine(blob.x, blob.y, lineRight[0], lineRight[1], 5);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob.x, blob.y, 5);
        }
        if (blob.y < getMapStartY() + distanceFromWallY) {
            //TOP
            //console.log("TOP");
            listToUse.push([
                [205, true],
                [335, false], this.computeInexpensiveDistance(blob.x, getMapStartY(), blob.x, blob.y)
            ]);
            lineLeft = this.followAngle(205, blob.x, blob.y, 190 + blob.size);
            lineRight = this.followAngle(335, blob.x, blob.y, 190 + blob.size);
            drawLine(blob.x, blob.y, lineLeft[0], lineLeft[1], 5);
            drawLine(blob.x, blob.y, lineRight[0], lineRight[1], 5);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob.x, blob.y, 5);
        }
        if (blob.x > getMapEndX() - distanceFromWallX) {
            //RIGHT
            //console.log("RIGHT");
            listToUse.push([
                [295, true],
                [65, false], this.computeInexpensiveDistance(getMapEndX(), blob.y, blob.x, blob.y)
            ]);
            lineLeft = this.followAngle(295, blob.x, blob.y, 190 + blob.size);
            lineRight = this.followAngle(65, blob.x, blob.y, 190 + blob.size);
            drawLine(blob.x, blob.y, lineLeft[0], lineLeft[1], 5);
            drawLine(blob.x, blob.y, lineRight[0], lineRight[1], 5);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob.x, blob.y, 5);
        }
        if (blob.y > getMapEndY() - distanceFromWallY) {
            //BOTTOM
            //console.log("BOTTOM");
            listToUse.push([
                [25, true],
                [155, false], this.computeInexpensiveDistance(blob.x, getMapEndY(), blob.x, blob.y)
            ]);
            lineLeft = this.followAngle(25, blob.x, blob.y, 190 + blob.size);
            lineRight = this.followAngle(155, blob.x, blob.y, 190 + blob.size);
            drawLine(blob.x, blob.y, lineLeft[0], lineLeft[1], 5);
            drawLine(blob.x, blob.y, lineRight[0], lineRight[1], 5);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob.x, blob.y, 5);
        }
        return listToUse;
    };

    //listToUse contains angles in the form of [angle, boolean].
    //boolean is true when the range is starting. False when it's ending.
    //range = [[angle1, true], [angle2, false]]

    this.getAngleIndex = function(listToUse, angle) {
        if (listToUse.length === 0) {
            return 0;
        }

        for (var i = 0; i < listToUse.length; i++) {
            if (angle <= listToUse[i][0]) {
                return i;
            }
        }

        return listToUse.length;
    };

    this.addAngle = function(listToUse, range) {
        //#1 Find first open element
        //#2 Try to add range1 to the list. If it is within other range, don't add it, set a boolean.
        //#3 Try to add range2 to the list. If it is withing other range, don't add it, set a boolean.

        //TODO: Only add the new range at the end after the right stuff has been removed.

        var newListToUse = listToUse.slice();

        var startIndex = 1;
        var i;

        if (newListToUse.length > 0 && !newListToUse[0][1]) {
            startIndex = 0;
        }

        var startMark = this.getAngleIndex(newListToUse, range[0][0]);
        var startBool = this.mod(startMark, 2) != startIndex;

        var endMark = this.getAngleIndex(newListToUse, range[1][0]);
        var endBool = this.mod(endMark, 2) != startIndex;

        var removeList = [];

        if (startMark != endMark) {
            //Note: If there is still an error, this would be it.
            var biggerList = 0;
            if (endMark == newListToUse.length) {
                biggerList = 1;
            }

            for (i = startMark; i < startMark + this.mod(endMark - startMark, newListToUse.length + biggerList); i++) {
                removeList.push(this.mod(i, newListToUse.length));
            }
        } else if (startMark < newListToUse.length && endMark < newListToUse.length) {
            var startDist = this.mod(newListToUse[startMark][0] - range[0][0], 360);
            var endDist = this.mod(newListToUse[endMark][0] - range[1][0], 360);

            if (startDist < endDist) {
                for (i = 0; i < newListToUse.length; i++) {
                    removeList.push(i);
                }
            }
        }

        removeList.sort(function(a, b){return b-a;});

        for (i = 0; i < removeList.length; i++) {
            newListToUse.splice(removeList[i], 1);
        }

        if (startBool) {
            newListToUse.splice(this.getAngleIndex(newListToUse, range[0][0]), 0, range[0]);
        }
        if (endBool) {
            newListToUse.splice(this.getAngleIndex(newListToUse, range[1][0]), 0, range[1]);
        }

        return newListToUse;
    };

    this.getAngleRange = function(blob1, blob2, index, radius) {
        var angleStuff = this.getEdgeLinesFromPoint(blob1, blob2, radius);

        var leftAngle = angleStuff[0];
        var rightAngle = this.rangeToAngle(angleStuff);
        var difference = angleStuff[1];

        drawPoint(angleStuff[2][0], angleStuff[2][1], 3, "");
        drawPoint(angleStuff[3][0], angleStuff[3][1], 3, "");

        //console.log("Adding badAngles: " + leftAngle + ", " + rightAngle + " diff: " + difference);

        var lineLeft = this.followAngle(leftAngle, blob1.x, blob1.y, constants.safeDistance + blob1.size - index * 10);
        var lineRight = this.followAngle(rightAngle, blob1.x, blob1.y, constants.safeDistance + blob1.size - index * 10);

        var color = constants.orange;
        if (this.isType(blob2, Classification.virus)) {
        	color = constants.cyan;
        } else if (this.isType(blob2, Classification.smallThreat) || 
        		this.isType(blob2, Classification.largeThreat)) { // (getCells().hasOwnProperty(blob2.id)) {
        	color = constants.red;
        } else if (this.isType(blob2, Classification.cluster)) {
        	color = constants.green;
        }

        drawLine(blob1.x, blob1.y, lineLeft[0], lineLeft[1], color);
        drawLine(blob1.x, blob1.y, lineRight[0], lineRight[1], color);
        drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob1.x, blob1.y, color);

        return [leftAngle, difference];
    };

    //Given a list of conditions, shift the angle to the closest available spot respecting the range given.
    this.shiftAngle = function(listToUse, angle, range) {
        //TODO: shiftAngle needs to respect the range! DONE?
        for (var i = 0; i < listToUse.length; i++) {
            if (this.angleIsWithin(angle, listToUse[i])) {
                //console.log("Shifting needed!");

                var angle1 = listToUse[i][0];
                var angle2 = this.rangeToAngle(listToUse[i]);

                var dist1 = this.mod(angle - angle1, 360);
                var dist2 = this.mod(angle2 - angle, 360);

                if (dist1 < dist2) {
                    if (this.angleIsWithin(angle1, range)) {
                        return angle1;
                    } else {
                        return angle2;
                    }
                } else {
                    if (this.angleIsWithin(angle2, range)) {
                        return angle2;
                    } else {
                        return angle1;
                    }
                }
            }
        }
        //console.log("No Shifting Was needed!");
        return angle;
    };
    this.inSplitRange = function(target) {

    	var range = constants.splitRangeMin;
    	
    	if (target.isMovingTowards) {
    		range = constants.splitRangeMax;
    	}

       	return target.distance < range;
    };
    
    this.closestCell = function (player, x, y) {

    	var i;
    	var info = { cell: null, distance: null };
    	
    	for (i = 0; i < player.cells.length; i++) {

    		var cell = player.cells[i];
    		var distance = this.computeDistance(cell.x, cell.y, x, y);
    		
    		if (!info.distance || distance < info.distance) {
    			info.distance = distance;
    			info.cell = cell;
    		}
    	}

        return info;
    };
}

function randomizedList(array) {
  var i,
      n = (array = array.slice()).length,
      head = null,
      node = head;
  while (n) {
    var next = {id: array.length - n, value: array[n - 1], next: null};
    if (node) node = node.next = next;
    else node = head = next;
    array[i] = array[--n];
  }
  return {head: head, tail: node};
}
// Returns the smallest circle that contains the specified circles.
function enclosingCircle(circles) {
  return enclosingCircleIntersectingCircles(randomizedList(circles), []);
}
// Returns the smallest circle that contains the circles L
// and intersects the circles B.
function enclosingCircleIntersectingCircles(L, B) {
  var circle,
      l0 = null,
      l1 = L.head,
      l2,
      p1;
  switch (B.length) {
    case 1: circle = B[0]; break;
    case 2: circle = circleIntersectingTwoCircles(B[0], B[1]); break;
    case 3: circle = circleIntersectingThreeCircles(B[0], B[1], B[2]); break;
  }
  while (l1) {
    p1 = l1.value, l2 = l1.next;
    if (!circle || !circleContainsCircle(circle, p1)) {
      // Temporarily truncate L before l1.
      if (l0) L.tail = l0, l0.next = null;
      else L.head = L.tail = null;
      B.push(p1);
      circle = enclosingCircleIntersectingCircles(L, B); // Note: reorders L!
      B.pop();
      // Move l1 to the front of L and reconnect the truncated list L.
      if (L.head) l1.next = L.head, L.head = l1;
      else l1.next = null, L.head = L.tail = l1;
      l0 = L.tail, l0.next = l2;
    } else {
      l0 = l1;
    }
    l1 = l2;
  }
  L.tail = l0;
  return circle;
}
// Returns true if the specified circle1 contains the specified circle2.
function circleContainsCircle(circle1, circle2) {
  var xc0 = circle1.x - circle2.x,
      yc0 = circle1.y - circle2.y;
  return Math.sqrt(xc0 * xc0 + yc0 * yc0) < circle1.size - circle2.size + 1e-6;
}
// Returns the smallest circle that intersects the two specified circles.
function circleIntersectingTwoCircles(circle1, circle2) {
  var x1 = circle1.x, y1 = circle1.y, r1 = circle1.size,
      x2 = circle2.x, y2 = circle2.y, r2 = circle2.size,
      x12 = x2 - x1, y12 = y2 - y1, r12 = r2 - r1,
      l = Math.sqrt(x12 * x12 + y12 * y12);
  return {
    x: (x1 + x2 + x12 / l * r12) / 2,
    y: (y1 + y2 + y12 / l * r12) / 2,
    size: (l + r1 + r2) / 2
  };
}
// Returns the smallest circle that intersects the three specified circles.
function circleIntersectingThreeCircles(circle1, circle2, circle3) {
  var x1 = circle1.x, y1 = circle1.y, r1 = circle1.size,
      x2 = circle2.x, y2 = circle2.y, r2 = circle2.size,
      x3 = circle3.x, y3 = circle3.y, r3 = circle3.size,
      a2 = 2 * (x1 - x2),
      b2 = 2 * (y1 - y2),
      c2 = 2 * (r2 - r1),
      d2 = x1 * x1 + y1 * y1 - r1 * r1 - x2 * x2 - y2 * y2 + r2 * r2,
      a3 = 2 * (x1 - x3),
      b3 = 2 * (y1 - y3),
      c3 = 2 * (r3 - r1),
      d3 = x1 * x1 + y1 * y1 - r1 * r1 - x3 * x3 - y3 * y3 + r3 * r3,
      ab = a3 * b2 - a2 * b3,
      xa = (b2 * d3 - b3 * d2) / ab - x1,
      xb = (b3 * c2 - b2 * c3) / ab,
      ya = (a3 * d2 - a2 * d3) / ab - y1,
      yb = (a2 * c3 - a3 * c2) / ab,
      A = xb * xb + yb * yb - 1,
      B = 2 * (xa * xb + ya * yb + r1),
      C = xa * xa + ya * ya - r1 * r1,
      r = (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  return {
    x: xa + xb * r + x1,
    y: ya + yb * r + y1,
    size: r
  };
}

window.botList.push(new AposBot());

window.updateBotList(); //This function might not exist yet.

/*
Array.prototype.peek = function() {
    return this[this.length - 1];
};

console.log("Running Apos Bot!");

var f = window;
var g = window.jQuery;

var sha = "efde0488cc2cc176db48dd23b28a20b90314352b";
function getLatestCommit() {
    window.jQuery.ajax({
            url: "https://api.github.com/repos/kepler155c/Agar.io-bot/git/refs/heads/master",
            cache: false,
            dataType: "jsonp"
        }).done(function(data) {
            console.dir(data.data);
            console.log("hmm: " + data.data.object.sha);
            sha = data.data.object.sha;

            function update(prefix, name, url) {
                window.jQuery(document.body).prepend("<div id='" + prefix + "Dialog' style='position: absolute; left: 0px; right: 0px; top: 0px; bottom: 0px; z-index: 100; display: none;'>");
                window.jQuery('#' + prefix + 'Dialog').append("<div id='" + prefix + "Message' style='width: 350px; background-color: #FFFFFF; margin: 100px auto; border-radius: 15px; padding: 5px 15px 5px 15px;'>");
                window.jQuery('#' + prefix + 'Message').append("<h2>UPDATE TIME!!!</h2>");
                window.jQuery('#' + prefix + 'Message').append("<p>Grab the update for: <a id='" + prefix + "Link' href='" + url + "' target=\"_blank\">" + name + "</a></p>");
                window.jQuery('#' + prefix + 'Link').on('click', function() {
                    window.jQuery("#" + prefix + "Dialog").hide();
                    window.jQuery("#" + prefix + "Dialog").remove();
                });
                window.jQuery("#" + prefix + "Dialog").show();
            }

            $.get('https://raw.githubusercontent.com/kepler155c/Agar.io-bot/master/bot.user.js?' + Math.floor((Math.random() * 1000000) + 1), function(data) {
                var latestVersion = data.replace(/(\r\n|\n|\r)/gm,"");
                latestVersion = latestVersion.substring(latestVersion.indexOf("// @version")+11,latestVersion.indexOf("// @grant"));

                latestVersion = parseFloat(latestVersion + 0.0000);
                var myVersion = parseFloat(aposBotVersion + 0.0000); 
                
                if(latestVersion > myVersion)
                {
                    update("aposBot", "bot.user.js", "https://github.com/kepler155c/Agar.io-bot/blob/" + sha + "/bot.user.js/");
                }
                console.log('Current bot.user.js Version: ' + myVersion + " on Github: " + latestVersion);
            });

        }).fail(function() {});
}
getLatestCommit();
*/
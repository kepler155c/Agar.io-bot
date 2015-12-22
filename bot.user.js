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
// @version     3.854
// @grant       none
// @author      http://www.twitch.tv/apostolique
// ==/UserScript==

var aposBotVersion = 3.854;

//TODO: Team mode
//      Detect when people are merging
//      Split to catch smaller targets
//      Angle based cluster code
//      Better wall code
//      In team mode, make allies be obstacles.

/*
Number.prototype.mod = function(n) {
    return ((this % n) + n) % n;
};
*/

Array.prototype.peek = function() {
    return this[this.length - 1];
};

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

console.log("Running Apos Bot!");

var f = window;
var g = window.jQuery;

console.log("Apos Bot!");

window.botList = window.botList || [];

/*function QuickBot() {
    this.name = "QuickBot V1";
    this.customParameters = {};
    this.keyAction = function(key) {};
    this.displayText = function() {return [];};
    this.mainLoop = function() {
        return [screenToGameX(getMouseX()),
                screenToGameY(getMouseY())];
    };
}

window.botList.push(new QuickBot());*/

function AposBot() {
    this.name = "AposBot " + aposBotVersion;

    this.toggleFollow = false;
    this.keyAction = function(key) {
        if (81 == key.keyCode) {
            console.log("Toggle Follow Mouse!");
            this.toggleFollow = !this.toggleFollow;
        }
    };

    this.displayText = function() {
        return ["Q - Follow Mouse: " + (this.toggleFollow ? "On" : "Off")];
    };

    // Using mod function instead the prototype directly as it is very slow
    this.mod = function(num, mod) {
        if (mod & (mod - 1) === 0 && mod !== 0) {
            return num & (mod - 1);
        }
        return num < 0 ? ((num % mod) + mod) % mod : num % mod;
    };
    this.splitDistance = 710;

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

    this.computeDistanceFromCircleEdgeDeprecated = function(x1, y1, x2, y2, s2) {
        var tempD = this.computeDistance(x1, y1, x2, y2);

        var offsetX = 0;
        var offsetY = 0;

        var ratioX = tempD / (x1 - x2);
        var ratioY = tempD / (y1 - y2);

        offsetX = x1 - (s2 / ratioX);
        offsetY = y1 - (s2 / ratioY);

        drawPoint(offsetX, offsetY, 5, "");

        return this.computeDistance(x2, y2, offsetX, offsetY);
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
    	
    	if (cell.size <= 14) {
    		return true;
    	}

    	if (!cell.isVirus() && this.canEat(blob, cell)) {
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
    
    this.canEat = function(eater, eatee) {
    	if (eater.size > eatee.size) {
        	return this.getMass(eater) / this.getMass(eatee) > 1.265;
    	}
    	return false;
    };

    // can i split and eat someone
    this.canSplitKill = function(eater, eatee) {

    	if (eater.size > eatee.size) {
    		return this.getSplitMass(eater) / this.getMass(eatee) > 1.265;
    	}
    	return false;
    };

    this.isThreat = function(blob, cell) {
    	
        if (!cell.isVirus() && this.canEat(cell, blob)) {
            return true;
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
    
    this.foodInVirus = function(food, viruses) {
        for (var i = 0; i < viruses.length; i++) {
        	var virus = viruses[i];
        	if (this.circlesIntersect(food, virus)) {
        		
                drawCircle(food.x, food.y, food.size + 10, 7);
        		return true;
        	}
        }
        return false;
    };
    
    this.isMovingTowards = function(a, b) {

    	if (b.isNotMoving()) {
    		return false;
    	}

    	var oldx = b.getLastPos().x;
    	var oldy = b.getLastPos().y;

    	return this.computeInexpensiveDistance(b.x, b.y, a.x, a.y) < this.computeInexpensiveDistance(oldx, oldy, a.x, a.y);
    };

    this.separateListBasedOnFunction = function(player, that, listToUse) {
        var foodElementList = [];
        var threatList = [];
        var virusList = [];
        var splitTargetList = [];
        var enemyList = [];
        var mergeList = [];
        var i;
        var closestInfo;
        
    	player.safeToSplit = true;

        Object.keys(listToUse).forEach(function(element, index) {

        	var entity = listToUse[element];
            var isMe = that.isItMe(player, entity);
            var isEnemy = true;
            
            if (isMe) {
                drawPoint(entity.x, entity.y+20, 1, "m:" + that.getMass(entity).toFixed(2) + " s:" + that.getSplitMass(entity).toFixed(2));
            } else {
            	
            	entity.isSplitTarget = false;
            	entity.isMovingTowards = that.isMovingTowards(player.enclosingCell, entity);
            	entity.mass = that.calculateMass(entity);
            	closestInfo = that.closestCell(player, entity.x, entity.y);

            	entity.closestCell = closestInfo.cell;
                entity.enemyDist = closestInfo.distance;

                if (that.isFood(player.smallestCell, entity) && entity.isNotMoving()) {
                    //IT'S FOOD!
               		foodElementList.push(entity);
                    isEnemy = false;
                } else if (that.isThreat(player.smallestCell, entity)) {
                    //IT'S DANGER!
                    threatList.push(entity);
                    mergeList.push(entity);
                    
                //} else if (that.isThreatIfSplit(blob, entity)) {
                //	threatIfSplitList.push()
                } else if (that.isVirus(player.largestCell, entity)) {
                    //IT'S VIRUS!
                    virusList.push(entity);
                    isEnemy = false;
                }
                else if (entity.closestCell.mass > 36 && that.canSplitKill(entity.closestCell, entity)) {

                	// only split kill if it's moving
                	entity.isSplitTarget = !entity.isNotMoving();

                	//if (player.largestCell.mass / entity.mass > 10) {
                        drawCircle(entity.x, entity.y, entity.size + 50, 7);
                        splitTargetList.push(entity);
                	//}

                    foodElementList.push(entity);
                    mergeList.push(entity);
                }
                else if (player.cells.length == 1 && that.canEat(player.smallestCell, entity)) {

                	foodElementList.push(entity);
                    mergeList.push(entity);
                	
                } else {
                	if (!that.isVirus(null, entity)) {
                		mergeList.push(entity);
                	}
                }
                
                if (isEnemy) {

                	if (entity.closestCell.size * entity.closestCell.size / 2 < entity.size * entity.size * 1.265) {
                		if (entity.enemyDist < 750 + entity.closestCell.size) {
                    		player.safeToSplit = false;
                		}
                	}

                	enemyList.push(entity);
                    drawPoint(entity.x, entity.y+20, 1, "m:" + that.getMass(entity).toFixed(2) + " s:" + that.getSplitMass(entity).toFixed(2));
                }
            }/*else if(isMe && (getBlobCount(getPlayer()) > 0)){
                //Attempt to make the other cell follow the mother one
                foodElementList.push(entity);
            }*/
        });

        if (player.isSplitting || player.cells.length > 1 || player.splitTargets.length === 0) {
        	player.safeToSplit = false;
        }

        foodList = [];
        for (i = 0; i < foodElementList.length; i++) {
        	if (!this.foodInVirus(foodElementList[i], virusList)) {
        		foodList.push(foodElementList[i]);
        	}
        }
        
        //console.log("Merglist length: " +  mergeList.length)
        //cell merging
        for (i = 0; i < mergeList.length; i++) {
            for (var z = 0; z < mergeList.length; z++) {
                if (z != i && that.isMerging(mergeList[i], mergeList[z])) { //z != i && 
                    //found cells that appear to be merging - if they constitute a threat add them to the theatlist
                    
                    //clone us a new cell
                    var newThreat = {};
                    var prop;
                    
                    for (prop in mergeList[i]) {
                        newThreat[prop] = mergeList[i][prop];
                    }
                    
                    //average distance and sum the size
                    newThreat.x = (mergeList[i].x + mergeList[z].x)/2;
                    newThreat.y = (mergeList[i].y + mergeList[z].y)/2;
                    newThreat.mass = mergeList[i].mass + mergeList[z].mass;
                    newThreat.size = Math.sqrt(newThreat.mass * 100);
                    newThreat.isMovingTowards = true;
                	closestInfo = that.closestCell(player, newThreat.x, newThreat.y);

                	newThreat.closestCell = closestInfo.cell;
                	newThreat.enemyDist = closestInfo.distance;
                    
                    newThreat.nopredict = true;
                    //check its a threat
                    if (that.isThreat(player.smallestCell, newThreat)) {
                         //IT'S DANGER!
                        threatList.push(newThreat);
                    }   
                }
            }
        }
        
        player.food = foodList;
        player.threats = threatList;
        player.viruses = virusList;
        player.splitTargets = splitTargetList;
        player.enemies = enemyList;
        
        return [foodList, threatList, virusList, splitTargetList, enemyList];
    };

    this.getAll = function(player) {
        var interNodes = getMemoryCells();

        return this.separateListBasedOnFunction(player, this, interNodes);
    };

    this.clusterFood = function(player, foodList, blobSize) {
        var clusters = [];
        var addedCluster = false;

        for (var i = 0; i < foodList.length; i++) {
        	
        	var food = foodList[i];
        	var foodSize = food.size;
        	
        	if (food.size <= 14) {
        		foodSize = food.size-9;
        	}

        	if (!food.isNotMoving()) {
        		
            	var lastPos = food.getLastPos();
            	var predictedX = food.x - (lastPos.x - food.x) * 30;
            	var predictedY = food.y - (lastPos.y - food.y) * 30;

                clusters.push({
                	x: predictedX, y: predictedY, size: food.size, cell: food
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
	                	x: food.x, y: food.y, size: foodSize, cell: null
	                });
	            }
        	}
            addedCluster = false;
        }
        
        return clusters;
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

    this.debugAngle = function(angle, text) {
        var player = getPlayer();
        var cell = player.cells[0];
        var line1 = this.followAngle(angle, cell.x, cell.y, 300);
        drawLine(cell.x, cell.y, line1[0], line1[1], 5);
        drawPoint(line1[0], line1[1], 5, "" + text);
    };

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

    this.invertAngle = function(range) { // Where are you getting all of these vars from? (badAngles and angle)
        var angle1 = this.rangeToAngle(badAngles[i]);
        var angle2 = this.mod(badAngles[i][0] - angle, 360);
        return [angle1, angle2];
    },

    this.addWall = function(listToUse, blob) {
    	
    	var lineLeft, lineRight;
        //var mapSizeX = Math.abs(f.getMapStartX - f.getMapEndX);
        //var mapSizeY = Math.abs(f.getMapStartY - f.getMapEndY);
        //var distanceFromWallX = mapSizeX/3;
        //var distanceFromWallY = mapSizeY/3;
        var distanceFromWallY = 2000;
        var distanceFromWallX = 2000;
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

        var lineLeft = this.followAngle(leftAngle, blob1.x, blob1.y, 150 + blob1.size - index * 10);
        var lineRight = this.followAngle(rightAngle, blob1.x, blob1.y, 150 + blob1.size - index * 10);

        if (blob2.isVirus()) {
            drawLine(blob1.x, blob1.y, lineLeft[0], lineLeft[1], 6);
            drawLine(blob1.x, blob1.y, lineRight[0], lineRight[1], 6);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob1.x, blob1.y, 6);
        } else if(getCells().hasOwnProperty(blob2.id)) {
            drawLine(blob1.x, blob1.y, lineLeft[0], lineLeft[1], 0);
            drawLine(blob1.x, blob1.y, lineRight[0], lineRight[1], 0);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob1.x, blob1.y, 0);
        } else {
            drawLine(blob1.x, blob1.y, lineLeft[0], lineLeft[1], 3);
            drawLine(blob1.x, blob1.y, lineRight[0], lineRight[1], 3);
            drawArc(lineLeft[0], lineLeft[1], lineRight[0], lineRight[1], blob1.x, blob1.y, 3);
        }

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
    
    this.getBestFood = function(player) {
    	
    	var i;
    	
        for (i = 0; i < player.foodClusters.length; i++) {
        	
            //This is the cost function. Higher is better.

        	var cluster = player.foodClusters[i];

        	var multiplier = 3;

        	if (cluster.x < getMapStartX()+1000 || 
        			cluster.x > getMapEndX()-1000 || 
        			cluster.y < getMapStartY()+1000 || 
        			cluster.y > getMapEndY()-1000) {
        		multiplier = 6;
        	} else if (cluster.x < getMapStartX()+2000 || 
        			cluster.x > getMapEndX()-2000 || 
        			cluster.y < getMapStartY()+2000 ||
        			cluster.y > getMapEndY()-2000) {
        		multiplier = 9;
        	}
        	
        	var closestInfo = this.closestCell(player, cluster.x, cluster.y);
            cluster.closestCell = closestInfo.cell;
            cluster.enemyDist = closestInfo.distance;
            
            var size = cluster.size;
            if (cluster.cell) {
            	if (cluster.cell.isNotMoving()) {
                	// easy food
            		size = size * 5;
            	} else if (player.safeToSplit && cluster.cell.isSplitTarget && cluster.enemyDist < this.splitDistance * 0.75 && cluster.cell.mass > 10) {
            		size = size * 3;
                }
            	if (cluster.cell.isMovingTowards) {
                	// prioritize enemies moving towards us
            		size = size * 1.2;
                }
            }
            cluster.clusterSize = closestInfo.distance / size * multiplier ;
            
            drawPoint(cluster.x, cluster.y+60, 1, "" + parseInt(cluster.clusterSize, 10) + " " + parseInt(cluster.size, 10));
        }
        
        var bestFoodI = 0;
        var bestFoodSize = player.foodClusters[0].clusterSize;
        for (i = 1; i < player.foodClusters.length; i++) {
            if (player.foodClusters[i].clusterSize < bestFoodSize) {
                bestFoodSize = player.foodClusters[i].clusterSize;
                bestFoodI = i;
            }
        }
        return player.foodClusters[bestFoodI];
    };
    
    this.determineDestination = function(player, allPossibleThreats, allPossibleViruses) {
    	
        //The bot works by removing angles in which it is too
        //dangerous to travel towards to.
        var badAngles = [];
        var obstacleList = [];
        var tempMoveX = getPointX();
        var tempMoveY = getPointY();
        var i, j, angle1, angle2, tempOb, line1, line2, diff, threat;
        var panicMode = false;

        for (j = 0; j < player.cells.length; j++) {
            for (i = 0; i < allPossibleThreats.length; i++) {
            	if (this.circlesIntersect(player.cells[j], allPossibleThreats[i])) {
            		panicMode = true;
            		break;
            	}
            }
        }

        for (i = 0; i < allPossibleThreats.length; i++) {
        	
        	var threat = allPossibleThreats[i];

            var closestCell = threat.closestCell;
            var enemyDistance = threat.enemyDist;

            if (enemyCanSplit) {	
                drawPoint(threat.x, threat.y+40, 1, "c:" + (this.getSplitMass(threat) / this.getMass(threat)).toFixed(2));
            }
            
            var enemyCanSplit = this.canSplitKill(threat, player.smallestCell);
            
            if (enemyCanSplit && this.getRatio(threat, player.smallestCell) > 20) {
            	enemyCanSplit = false;
            }

            if (panicMode) {
            	console.log('panic mode');
            	enemyCanSplit = false;
            	
            	// save the biggest cell
            	closestCell = player.largestCell;
            }

            var normalDangerDistance = threat.size + 150;
            var shiftDistance = player.enclosingCell.size;
            var splitDangerDistance = threat.size + this.splitDistance + 150;
            var secureDistance = (enemyCanSplit ? splitDangerDistance : normalDangerDistance);
            
            threat.dangerZone = secureDistance;

            for (j = player.foodClusters.length - 1; j >= 0 ; j--) {
                if (this.computeDistance(threat.x, threat.y, player.foodClusters[j].x, player.foodClusters[j].y) < secureDistance + shiftDistance)
                    player.foodClusters.splice(j, 1);
            }

            if (panicMode || threat.danger && getLastUpdate() - threat.dangerTimeOut > 400) {

                threat.danger = false;
            }

            /*if ((enemyCanSplit && enemyDistance < splitDangerDistance) ||
                (!enemyCanSplit && enemyDistance < normalDangerDistance)) {

                threat.danger = true;
                threat.dangerTimeOut = f.getLastUpdate();
            }*/

            //console.log("Figured out who was important.");
            
            if ((enemyCanSplit && enemyDistance < splitDangerDistance) || (enemyCanSplit && threat.danger)) {

                badAngles.push(this.getAngleRange(closestCell, threat, i, splitDangerDistance).concat(threat.enemyDist));

            } else if ((!enemyCanSplit && enemyDistance < normalDangerDistance) || (!enemyCanSplit && threat.danger)) {

                badAngles.push(this.getAngleRange(closestCell, threat, i, normalDangerDistance).concat(threat.enemyDist));

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
            //console.log("Done with enemy: " + i);
        }

        //console.log("Done looking for enemies!");

        for (i = 0; i < allPossibleViruses.length; i++) {
        	
        	var virus = allPossibleViruses[i];

        	for (j = 0; j < player.cells.length; j++) {

        		var cell = player.cells[j];
        		if (panicMode) {
        			cell = player.largestCell;
        		}
        			
        		var virusDistance = this.computeDistance(virus.x, virus.y, cell.x, cell.y);
	            if (cell.size < virus.size) {
	                if (virusDistance < (virus.size * 2)) {
	                    tempOb = this.getAngleRange(cell, virus, i, virus.size + 10);
	                    angle1 = tempOb[0];
	                    angle2 = this.rangeToAngle(tempOb);
	                    obstacleList.push([[angle1, true], [angle2, false]]);
	                }
	            } else {
	                if (virusDistance < (cell.size * 2)) {
	                    tempOb = this.getAngleRange(cell, virus, i, cell.size + 50);
	                    angle1 = tempOb[0];
	                    angle2 = this.rangeToAngle(tempOb);
	                    obstacleList.push([[angle1, true], [angle2, false]]);
	                }
	            }
	            if (panicMode) {
	            	break;
        		}
        	}
        }

        var stupidList = [];

        if (badAngles.length > 0) {
            //NOTE: This is only bandaid wall code. It's not the best way to do it.
            stupidList = this.addWall(stupidList, player.enclosingCell);
        }

        for (i = 0; i < badAngles.length; i++) {
            angle1 = badAngles[i][0];
            angle2 = this.rangeToAngle(badAngles[i]);
            stupidList.push([[angle1, true], [angle2, false], badAngles[i][2]]);
        }

        //stupidList.push([[45, true], [135, false]]);
        //stupidList.push([[10, true], [200, false]]);

        stupidList.sort(function(a, b){
            //console.log("Distance: " + a[2] + ", " + b[2]);
            return a[2]-b[2];
        });

        //console.log("Added random noob stuff.");

        var sortedInterList = [];
        var sortedObList = [];

        for (i = 0; i < stupidList.length; i++) {
            //console.log("Adding to sorted: " + stupidList[i][0][0] + ", " + stupidList[i][1][0]);
            var tempList = this.addAngle(sortedInterList, stupidList[i]);

            if (tempList.length === 0) {
                console.log("MAYDAY IT'S HAPPENING!");

                /*
                for (var i = 0; i < allPossibleThreats.length; i++) {

                    var enemyDistance = this.computeDistance(allPossibleThreats[i].x, allPossibleThreats[i].y, cell.x, cell.y, allPossibleThreats[i].size);
                }
                */

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
            line1 = this.followAngle(goodAngles[i][0], player.enclosingCell.x, player.enclosingCell.y, 100 + player.enclosingCell.size);
            line2 = this.followAngle(this.mod(goodAngles[i][0] + goodAngles[i][1], 360), player.enclosingCell.x, player.enclosingCell.y, 100 + player.enclosingCell.size);
            drawLine(player.enclosingCell.x, player.enclosingCell.y, line1[0], line1[1], 1);
            drawLine(player.enclosingCell.x, player.enclosingCell.y, line2[0], line2[1], 1);

            drawArc(line1[0], line1[1], line2[0], line2[1], player.enclosingCell.x, player.enclosingCell.y, 1);

            //drawPoint(player[0].x, player[0].y, 2, "");

            drawPoint(line1[0], line1[1], 0, "" + i + ": 0");
            drawPoint(line2[0], line2[1], 0, "" + i + ": 1");
        }

        for (i = 0; i < obstacleAngles.length; i++) {
            line1 = this.followAngle(obstacleAngles[i][0], player.enclosingCell.x, player.enclosingCell.y, 50 + player.enclosingCell.size);
            line2 = this.followAngle(this.mod(obstacleAngles[i][0] + obstacleAngles[i][1], 360), player.enclosingCell.x, player.enclosingCell.y, 50 + player.enclosingCell.size);
            drawLine(player.enclosingCell.x, player.enclosingCell.y, line1[0], line1[1], 6);
            drawLine(player.enclosingCell.x, player.enclosingCell.y, line2[0], line2[1], 6);

            drawArc(line1[0], line1[1], line2[0], line2[1], player.enclosingCell.x, player.enclosingCell.y, 6);

            //drawPoint(player[0].x, player[0].y, 2, "");

            drawPoint(line1[0], line1[1], 0, "" + i + ": 0");
            drawPoint(line2[0], line2[1], 0, "" + i + ": 1");
        }

        if (this.toggleFollow && goodAngles.length === 0) {
            //This is the follow the mouse mode
            var distance = this.computeDistance(player.enclosingCell.x, player.enclosingCell.y, tempPoint[0], tempPoint[1]);

            var shiftedAngle = this.shiftAngle(obstacleAngles, this.getAngle(tempPoint[0], tempPoint[1], player.enclosingCell.x, player.enclosingCell.y), [0, 360]);

            var destination = this.followAngle(shiftedAngle, player.enclosingCell.x, player.enclosingCell.y, distance);

            destinationChoices = destination;
            drawLine(player.enclosingCell.x, player.enclosingCell.y, destination[0], destination[1], 1);
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

            line1 = this.followAngle(perfectAngle, player.enclosingCell.x, player.enclosingCell.y, verticalDistance());

            destinationChoices = line1;
            drawLine(player.enclosingCell.x, player.enclosingCell.y, line1[0], line1[1], 7);
            //tempMoveX = line1[0];
            //tempMoveY = line1[1];
        } else if (badAngles.length > 0 && goodAngles.length === 0) {
            //When there are enemies around but no good angles
            //You're likely screwed. (This should never happen.)

            console.log("Failed");
            destinationChoices = [tempMoveX, tempMoveY];
            /*var angleWeights = [] //Put weights on the angles according to enemy distance
            for (var i = 0; i < allPossibleThreats.length; i++){
                var dist = this.computeDistance(player.enclosingCell.x, player.enclosingCell.y, allPossibleThreats[i].x, allPossibleThreats[i].y);
                var angle = this.getAngle(allPossibleThreats[i].x, allPossibleThreats[i].y, player.enclosingCell.x, player.enclosingCell.y);
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
            line1 = this.followAngle(finalAngle,player.enclosingCell.x,player.enclosingCell.y,f.verticalDistance());
            drawLine(player.enclosingCell.x, player.enclosingCell.y, line1[0], line1[1], 2);
            destinationChoices.push(line1);*/
        } else if (player.foodClusters.length > 0) {
        	
        	var doSplit = false;

        	var cluster = this.getBestFood(player);

        	drawCircle(cluster.x, cluster.y, cluster.size + 30, 2);

            // drawPoint(bestFood.x, bestFood.y, 1, "");
            if (cluster.cell != null && cluster.cell.isSplitTarget) {
            	
				console.log("dist: " + cluster.enemyDist);
				console.log(cluster.cell && cluster.cell.isSplitTarget);
				console.log(cluster.cell.isSplitTarget);
				console.log(cluster);
                	//drawCircle(target.x, target.y, target.size + 30, 5);
				player.isSplitting = true;

                setTimeout(function() {
                	player.isSplitting = false;
                	console.log('resetting split timer');
                }, 500);
                
                doSplit = true;
            }

            angle = this.getAngle(cluster.x, cluster.y, cluster.closestCell.x, cluster.closestCell.y);
            var shiftedAngle = this.shiftAngle(obstacleAngles, angle, [0, 360]);

            var destination = this.followAngle(shiftedAngle, cluster.closestCell.x, cluster.closestCell.y, cluster.enemyDist);

            destinationChoices = [ destination[0], destination[1], doSplit ];

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
    this.mainLoop = function() {
        var player = getPlayer();
        var interNodes = getMemoryCells();
        var i;

        if ( /*!toggle*/ 1) {
            //The following code converts the mouse position into an
            //absolute game coordinate.
            var useMouseX = screenToGameX(getMouseX());
            var useMouseY = screenToGameY(getMouseY());
            tempPoint = [useMouseX, useMouseY, 1];

            //The current destination that the cells were going towards.

            drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX() + (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), 7);
            drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), getX() + (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), 7);
            drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX() - (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), 7);
            drawLine(getX() + (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX() + (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), 7);

            //This variable will be returned at the end.
            //It will contain the destination choices for all the cells.
            //BTW!!! ERROR ERROR ABORT MISSION!!!!!!! READ BELOW -----------
            //
            //SINCE IT'S STUPID NOW TO ASK EACH CELL WHERE THEY WANT TO GO,
            //THE BOT SHOULD SIMPLY PICK ONE AND THAT'S IT, I MEAN WTF....
            var destinationChoices = []; //destination, size, danger

            //Just to make sure the player is alive.
            if (player.isAlive) {
            	
            	var cells = player.cells;

                //Loop through all the player's cells.
            	/*
                for (var k = 0; k < cells.length; k++) {
                	var cell = cells[k];
                    drawPoint(cell.x, cell.y + cell.size, 0, "" + (getLastUpdate() - cell.birth) + " / " + 
                    		(30000 + (cell.birthMass * 57) - (getLastUpdate() - cell.birth)) + " / " + cell.birthMass);
                }
                */
            	
            	if (player.isSplitting) {
            		return [ getPointX(), getPointY() ];
            	}

            	if (player.cells.length > 1) {
                    drawCircle(player.enclosingCell.x, player.enclosingCell.y, player.enclosingCell.size, 6);
            	}
            	
            	if (player.safeToSplit) {
                	drawCircle(player.enclosingCell.x, player.enclosingCell.y, player.enclosingCell.size + 30, 2);
            	}

                //Loops only for one cell for now.
                for (var k = 0; /*k < player.length*/ k < 1; k++) {

                    //console.log("Working on blob: " + k);
                	var cell = player.cells[k];

                    drawCircle(player.enclosingCell.x, player.enclosingCell.y, player.enclosingCell.size + this.splitDistance, 5);
                    //drawPoint(player[0].x, player[0].y - player[0].size, 3, "" + Math.floor(player[0].x) + ", " + Math.floor(player[0].y));

                    //var allDots = processEverything(interNodes);

                    //loop through everything that is on the screen and
                    //separate everything in it's own category.
                    var allIsAll = this.getAll(player);

                    //The food stored in element 0 of allIsAll
                    var allPossibleFood = allIsAll[0];
                    //The threats are stored in element 1 of allIsAll
                    var allPossibleThreats = allIsAll[1];
                    //The viruses are stored in element 2 of allIsAll
                    var allPossibleViruses = allIsAll[2];

                    player.foodClusters = this.clusterFood(player, allPossibleFood, player.largestCell.size);
                    
                    /*allPossibleThreats.sort(function(a, b){
                        return a.enemyDist-b.enemyDist;
                    })*/

                    for (i = 0; i < allPossibleViruses.length; i++) {
                        if (cell.size < allPossibleViruses[i].size) {
                            drawCircle(allPossibleViruses[i].x, allPossibleViruses[i].y, allPossibleViruses[i].size + 10, 3);
                            drawCircle(allPossibleViruses[i].x, allPossibleViruses[i].y, allPossibleViruses[i].size * 2, 6);

                        } else {
                            drawCircle(allPossibleViruses[i].x, allPossibleViruses[i].y, cell.size + 50, 3);
                            drawCircle(allPossibleViruses[i].x, allPossibleViruses[i].y, cell.size * 2, 6);
                        }
                    }

                    destinationChoices = this.determineDestination(player, allPossibleThreats, allPossibleViruses);
                    
                    for (i = 0; i < allPossibleThreats.length; i++) {

                    	drawCircle(allPossibleThreats[i].x, allPossibleThreats[i].y, allPossibleThreats[i].size + 30, 0);
                    	
	                	if (this.isMovingTowards(cell, allPossibleThreats[i])) {
	                    	drawCircle(allPossibleThreats[i].x, allPossibleThreats[i].y, allPossibleThreats[i].size + 10, 3);
	                	}

   	                    drawCircle(allPossibleThreats[i].x, allPossibleThreats[i].y, allPossibleThreats[i].dangerZone, 0);
                    }
                    
                    drawPoint(tempPoint[0], tempPoint[1], tempPoint[2], "");
                    //drawPoint(tempPoint[0], tempPoint[1], tempPoint[2], "" + Math.floor(this.computeDistance(tempPoint[0], tempPoint[1], I, J)));
                    //drawLine(tempPoint[0], tempPoint[1], player[0].x, player[0].y, 6);
                    //console.log("Slope: " + slope(tempPoint[0], tempPoint[1], player[0].x, player[0].y) + " Angle: " + getAngle(tempPoint[0], tempPoint[1], player[0].x, player[0].y) + " Side: " + this.mod(getAngle(tempPoint[0], tempPoint[1], player[0].x, player[0].y) - 90, 360));
                    tempPoint[2] = 1;

                    //console.log("Done working on blob: " + i);
                }

                //TODO: Find where to go based on destinationChoices.
                /*var dangerFound = false;
                for (var i = 0; i < destinationChoices.length; i++) {
                    if (destinationChoices[i][2]) {
                        dangerFound = true;
                        break;
                    }
                }

                destinationChoices.sort(function(a, b){return b[1] - a[1]});

                if (dangerFound) {
                    for (var i = 0; i < destinationChoices.length; i++) {
                        if (destinationChoices[i][2]) {
                            tempMoveX = destinationChoices[i][0][0];
                            tempMoveY = destinationChoices[i][0][1];
                            break;
                        }
                    }
                } else {
                    tempMoveX = destinationChoices.peek()[0][0];
                    tempMoveY = destinationChoices.peek()[0][1];
                    //console.log("Done " + tempMoveX + ", " + tempMoveY);
                }*/
            }
            //console.log("MOVING RIGHT NOW!");

            //console.log("______Never lied ever in my life.");

            return destinationChoices;
        }
    };
}

window.botList.push(new AposBot());

window.updateBotList(); //This function might not exist yet.

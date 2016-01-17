'use strict';

/* jshint browser: true, laxbreak: true */
/* global console, $ */
/* global drawPoint, drawLine, drawCircle, drawArc, getModek, getMapStartX, getMapStartY */
/* global getPointX, getPointY, getMapEndX, getMapEndY, getMouseX, getMouseY */
/* global getZoomlessRatio, verticalDistance, getPlayer, screenToGameX, screenToGameY */
/* global getX, getY, getMemoryCells, getCells, getMode, getLastUpdate, isHumanControlled */
/* global setHumanControlled, getEverything */

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
// @version     3.1577
// @grant       none
// @author      http://www.twitch.tv/apostolique
// ==/UserScript==
var aposBotVersion = 3.1577;

var Constants = {
	splitRangeMin : 650,
	splitRangeMax : 700, // 674.5,
	enemySplitDistance : 710,
	playerRatio : 1.285,
	enemyRatio : 1.27,
	splitDuration : 1000, // 800 was pretty good
	splitVelocity : 25,

	virusShotDistance : 800, // distance a virus travels when shot
	virusFeedAmount : 7, // Amount of times you need to feed a virus to shoot it
	ejectMass : 13.7, // was 12, // Mass of ejected cells
	ejectMassCooldown : 200, // Time until a player can eject mass again
	ejectMassLoss : 19, // was 16, // Mass lost when ejecting cells
	ejectSpeed : 160, // Base speed of ejected cells
	playerMinMassEject : 32, // Mass required to eject a cell
	playerMinMassSplit : 36, // Mass required to split
	playerMaxCells : 16, // Max cells the player is allowed to have
	playerRecombineTime : 30, // Base amount of seconds before a cell is allowed to recombine
	playerMassDecayRate : 0.002, // Amount of mass lost per second
	playerMinMassDecay : 9, // Minimum mass for decay to occur
	playerSpeed : 30, // Player base speed

	// adjustables
	lureDistance : 1000,
	largeThreatRatio : 10,

	red : "#FF0000",
	green : "#00FF00",
	blue : "#0000FF",
	orange : "#FF8000",
	purple : "#8A2BE2",
	pink : "#FF69B4",
	cyan : "#008080",
	gray : "#F2FBFF",
	black : "#000000",
	yellow : "#FFFF00",
};

window.Constants = Constants;

var Classification = {
	unknown : 0,
	virus : 1,
	food : 2,

	noThreat : 3,
	threat : 4,

	mergeTarget : 6,
	splitTarget : 7,

	player : 8,
	cluster : 9
};

function Point(x, y) {
	this.x = x;
	this.y = y;
}

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
	this.isLuring = false;
	this.isMerging = false;

	this.chasing = 0;
	this.fuseTimer = null;
	this.action = null;
	this.lastPoint = null;

	this.lureTimer = Date.now();
};

Player.prototype = {

	setCells : function(cells) {
		this.cells = cells;
		this.isAlive = this.cells.length > 0;
		this.mass = 0;
		this.smallestCell = cells[0];
		this.largestCell = cells[0];

		for (var i = 0; i < cells.length; i++) {
			var cell = cells[i];

			cell.mass = cell.size * cell.size / 100;
			cell.isMe = true;

			this.mass = this.mass + cell.mass;

			if (cell.size < this.smallestCell.size) {
				this.smallestCell = cell;
			}
			if (cell.size > this.largestCell.size) {
				this.largestCell = cell;
			}

			if (cells.length > 0) {
				if (!cell.fuseTimer) {
					cell.fuseTimer = Date.now() + (30 + cell.mass * 0.0233) * 1000;
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
	},
	isSafeToSplit : function(entities) {

		this.safeToSplit = true; //this.cells.length == 1;

		Object.keys(entities).forEach(
				function(key) {

					var entity = entities[key];
					// if any largish enemies are within our split radius, dont allow split
					if (!entity.isVirus() && entity.size > 14 && !entity.isType(Classification.player)) {

						if (entity.closestCell.size * entity.closestCell.size / 2 < entity.size * entity.size
								* Constants.enemyRatio) {
							if (entity.distance < entity.size + entity.closestCell.size) {
								this.safeToSplit = false;
							}
						}
					}
				}, this);

		//this.safeToSplit = true;
	},
	merge : function() {

		if (this.cells.length > 1) {

			this.mergeInfo = {
				cellCount : this.cells.length,
				x : Math.floor(this.x),
				y : Math.floor(this.y)
			};
			this.action = this.mergeAction;
		}
	},
	mergeAction : function(destination) {

		if (this.cells.length >= this.mergeInfo.cellCount) {

			destination.point.x = this.mergeInfo.x;
			destination.point.y = this.mergeInfo.y;
			return true;
		}
		this.action = null;
		return false;
	},
	canSplit : function() {

		if (this.cells.length < 16) {

			for (var i = 0; i < this.cells.length; i++) {
				if (this.cells[i].mass > 36) {
					return true;
				}
			}
		}
		return false;
	},
	closestCell : function(x, y) {

		var i;
		var info = {
			cell : null,
			distance : null
		};

		for (i = 0; i < this.cells.length; i++) {

			var cell = this.cells[i];
			var distance = Util.computeDistance(cell.x, cell.y, x, y);

			if (!info.distance || distance < info.distance) {
				info.distance = distance;
				info.cell = cell;
			}
		}

		return info;
	},
	checkIfMerging : function() {

		this.isMerging = false;

		for (var i = 0; i < this.cells.length; i++) {

			var entityA = this.cells[i];

			for (var b = i + 1; b < this.cells.length; b++) {

				var entityB = this.cells[b];

				if (Util.circlesIntersect(entityA, entityB, 0.8)) {

					this.isMerging = true;
				}
			}
		}
	},
	split : function(cluster, x, y, destination) {

		if (this.canSplit() && (cluster && (typeof cluster.cell.isMe == "undefined"))) {

			this.splitInfo = {
				target : null,
				size : Math.floor(this.size),
				timer : Date.now(),
				initialSize : Math.floor(this.cells[0].size * 0.9),
				location : null
			};

			this.action = this.splitAction;
			destination.split = true;

			if (cluster) {
				this.splitInfo.target = cluster.cell;
				// really should use an angle here
				this.splitInfo.location = new Point(cluster.closestCell.x + (x - cluster.closestCell.x) * 4,
						cluster.closestCell.y + (y - cluster.closestCell.y) * 4);
				destination.point = this.splitInfo.location;
				console.log("splitting for: " + cluster.cell.isRemoved + cluster.cell.interceptVelocity);
				console.log([ cluster.cell.distance, cluster.cell.size, cluster.cell.closestCell.size ]);
				console.log(cluster.cell);
			}
		}
	},
	splitAction : function(destination) {

		if (Math.floor(this.size) <= this.splitInfo.size && (Date.now() - this.splitInfo.timer > 100)
				&& this.cells[0].size < this.splitInfo.initialSize || (Date.now() - this.splitInfo.timer > 1000)) {

			// player size grows as long as we are splitting
			this.action = null;
		} else {
			this.splitInfo.size = Math.floor(this.size);

			drawCircle(this.splitInfo.location.x, this.splitInfo.location.y, 50, Constants.green);
			if (this.splitInfo.target) {
				destination.point.x = this.splitInfo.target.x;
				destination.point.y = this.splitInfo.target.y;
			}
			return true;
		}
	},
	canShoot : function(numberOfShots) {

		var minSize = 32 * this.cells.length + numberOfShots * 19;

		return this.mass > minSize;
	},
	shootVirus : function(virus, destination) {

		var cell = virus.closestCell;
		var distance = virus.distance;

		if (distance - cell.size < 300) {
			destination.point.x = virus.x;
			destination.point.y = virus.y;
			destination.shoot = true;
			destination.override = true;
		}
	},
	ejectVirus : function() {

		if (this.closestVirus) {

			setHumanControlled(false);

			this.action = this.shootVirusAction;
			this.virusShootInfo = {
				virus : this.closestVirus,
				mass : this.mass,
				startingMass : this.closestVirus.mass
			};
		}
	},
	shootVirusAction : function(destination) {

		var info = this.virusShootInfo;
		var virus = info.virus;

		if (virus.distance > virus.closestCell.size && this.canShoot(1)) {

			var cell = virus.closestCell;
			var distance = virus.distance;

			var virusAngle = Util.getAngle(cell.x, cell.y, virus.x, virus.y);
			var movementAngle = cell.getMovementAngle();

			var angle = Math.atan2(cell.y - virus.y, cell.x - virus.x);

			// moving forward and not too close
			if (Math.abs(virusAngle - movementAngle) < 30 && virus.distance > (virus.size / 2) + cell.size
					&& virus.distance < virus.size + cell.size + 150) {
				// the virus has reduced in size (split hopefully)
				// the distance is still in range
				// we haven't lost too much mass (shooting wildly)

				if (virus.mass >= info.startingMass - 1 && info.mass - this.mass < 150) {

					destination.point.x = virus.x;
					destination.point.y = virus.y;
					destination.shoot = true;

				} else {

					this.action = null;
					return false;
				}

			} else if (virus.distance < virus.size + cell.size + 50) { // too close - back up

				destination.point.x = Math.floor(cell.x + Math.cos(angle) * (distance / 2));
				destination.point.y = Math.floor(cell.y + Math.sin(angle) * (distance / 2));

			} else {

				destination.point.x = Math.floor(cell.x - Math.cos(angle) * (distance / 2));
				destination.point.y = Math.floor(cell.y - Math.sin(angle) * (distance / 2));
			}
			drawLine(cell.x, cell.y, destination.point.x, destination.point.y, Constants.red);

			destination.override = true;
			return true;
		}

		this.action = null;
		return false;
	},
	lure : function(cluster, destination) {
		// really bad condition logic - but check if it's a split target just outside of range
		if ((Date.now() - this.lureTimer > 5000)
				&& this.safeToSplit
				&& cluster.cell
				&& cluster.cell.isType(Classification.splitTarget)
				&& !cluster.cell.isMovingTowards
				&& cluster.distance < this.size + Constants.lureDistance
				&& cluster.distance > this.size + Constants.splitRangeMax
				&& this.mass > 250
				&& ((this.mass - Constants.ejectMassLoss) / (cluster.cell.mass + Constants.ejectMass) > Constants.playerRatio)) {

			// TODO: figure out lure amount
			this.lureTimer = Date.now();
			destination.shoot = true;
		}
	},
	eachCellThreat : function(fn, thisp) {

		for (var i = 0; i < this.cells.length; i++) {
			var cell = this.cells[i];

			for (var j = 0; j < cell.threats.length; j++) {
				fn.call(thisp, cell, cell.threats[j], this);
			}
		}
	},
	sortThreats : function() {

		this.allThreats.sort(function(a, b) {
			return Math.min(a.distance - a.dangerZone, 0) - Math.min(b.distance - b.dangerZone, 0);
		});
	},
	singleThreatEvasionStrategy : function() {
		// angle away from the closest threat and the next closest threat (if within range)

		drawCircle(this.x, this.y, this.size + 16, Constants.pink);

		if (this.allThreats.length > 1) {

			this.sortThreats();

			for (var i = 1; i < this.allThreats.length; i++) {
				var threat = this.allThreats[i];

				if (threat.t != this.allThreats[0].t) {

					if (threat.distance - threat.dangerZone < 750) {
						threat.dangerZone = threat.distance + 1;
						drawCircle(threat.x, threat.y, threat.dangerZone, Constants.red);
					}
					break;
				}
			}

		}
	},
	multiThreatEvasionStrategy : function() {

		drawCircle(this.x, this.y, this.size + 16, Constants.orange);

		this.eachCellThreat(function(cell, threat) {

			if (!threat.isMovingTowards || threat.teamSize > 1) {
				threat.dangerZone = threat.minDistance;
				threat.isSplitThreat = false;
			}
		}, this);
	},
	intersectEvasionStrategy : function() {

		drawCircle(this.x, this.y, this.size + 16, Constants.red);

		this.eachCellThreat(function(cell, threat) {

			threat.dangerZone = threat.minDistance;
			threat.isSplitThreat = false;

		}, this);
	},
};

var Util = function() {
};

Util.computeDistance = function(x1, y1, x2, y2, s1, s2) {
	// Make sure there are no null optional params.
	s1 = s1 || 0;
	s2 = s2 || 0;
	var xdis = x1 - x2; // <--- FAKE AmS OF COURSE!
	var ydis = y1 - y2;
	var distance = Math.sqrt(xdis * xdis + ydis * ydis) - (s1 + s2);

	return distance;
};

Util.getAngle = function(x1, y1, x2, y2) {
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

Util.circlesIntersect = function(circle1, circle2, percentage) {
	var distanceX = circle1.x - circle2.x;
	var distanceY = circle1.y - circle2.y;
	var radiusSum = circle1.size + circle2.size;

	if (percentage) {

		return radiusSum * radiusSum - (radiusSum * percentage * 10) > distanceX * distanceX + distanceY * distanceY; // 10%
	}

	return distanceX * distanceX + distanceY * distanceY <= radiusSum * radiusSum;
};

function initializeEntity() {

	var da = window.getEntityPrototype();

	da.prototype.initialize = function(player) {

		this.classification = Classification.unknown;
		this.hasMoved = this.isMoving();
		this.isMovingTowards = this.getMovingTowards(player);
		this.mass = this.size * this.size / 100;
		this.originalMass = this.mass; // save the original mass in case the merge logic changes it
		this.safeDistance = 0;
		this.teamSize = 1;
		this.teamMass = this.mass;
		this.isSplitThreat = false;
		this.velocity = 0;

		var closestInfo = player.closestCell(this.x, this.y);
		this.closestCell = closestInfo.cell;
		this.distance = closestInfo.distance;

		if (!this.lastSize) {
			this.lastSize = this.size;
		}
		/*
		if (entity.hasMoved) {
			this.predictPosition(Constants.splitDuration, this.previousUpdated);
		}
		*/
	};

	da.prototype.isType = function(classification) {
		return this.classification == classification;
	};

	da.prototype.getMovingTowards = function(target) {

		if (!this.hasMoved) {
			return false;
		}

		var a = this.getLastPos();

		var bAngle = Util.getAngle(a.x, a.y, this.x, this.y);
		var targetAngle = Util.getAngle(this.x, this.y, target.x, target.y);

		return Math.abs(bAngle - targetAngle) < 30;
	};

	da.prototype.predictPosition = function(timeDiff, previousUpdate) {

		var a = (getLastUpdate() - previousUpdate) / 120;
		a = 0 > a ? 0 : 1 < a ? 1 : a;

		timeDiff = timeDiff / 60;

		this.px = timeDiff * a * (this.J - this.s) + this.x;
		this.py = timeDiff * a * (this.K - this.t) + this.y;
	};

	// predicted position on next update
	da.prototype.futurePosition = function() {
		var lastPos = this.getLastPos();

		this.px = (this.x - lastPos.x) + this.x;
		this.py = (this.y - lastPos.y) + this.y;
	};

	da.prototype.getVelocity = function(previousUpdate) {
		var lastPos = this.getLastPos();

		return Util.computeDistance(this.x, this.y, lastPos.x, lastPos.y);
	};

	da.prototype.getMovementAngle = function() {

		var lastPos = this.getLastPos();

		return Util.getAngle(lastPos.x, lastPos.y, this.x, this.y);
	};

	var entitiesPrototype = Object.getPrototypeOf(getMemoryCells());

	entitiesPrototype.foodFilter = function(key) {

		var entity = this[key];

		return entity.isType(Classification.food) || entity.isType(Classification.splitTarget)
				|| entity.isType(Classification.mergeTarget);
	};

	entitiesPrototype.virusFilter = function(key) {

		var entity = this[key];

		return entity.isType(Classification.virus);
	};

	entitiesPrototype.movingFilter = function(key) {

		var entity = this[key];

		return entity.hasMoved;
	};

	entitiesPrototype.mergeFilter = function(key) {

		var entity = this[key];

		// added size in order to increase performance
		if (entity.isVirus() || entity.isType(Classification.player) || entity.size <= 14) {
			return false;
		}
		return true;
	};

	entitiesPrototype.splitThreatFilter = function(key) {

		var entity = this[key];

		return entity.isType(Classification.threat) && entity.isSplitThreat;
	};

	entitiesPrototype.threatFilter = function(key) {

		var entity = this[key];

		return entity.isType(Classification.threat);
	};
	entitiesPrototype.threatAndVirusFilter = function(key) {

		var entity = this[key];

		return entity.isType(Classification.threat) || entity.isType(Classification.virus);
	};
}

console.log("Apos Bot!");

window.botList = window.botList || [];

function AposBot() {
	this.name = "AposBot " + aposBotVersion;

	this.initialized = false;
	this.toggleFollow = false;
	this.infoStrings = [];
	this.moreInfoStrings = [];
	this.previousUpdated = Date.now();
	this.keyAction = function(key) {
		if (81 == key.keyCode) { // 'q'
			this.toggleFollow = !this.toggleFollow;
		} else if (key.keyCode == 69) { // 'e'
			this.player.ejectVirus();
		} else if (key.keyCode == 77) { // 'm'
			this.player.merge();
		}
	};

	this.player = new Player();

	this.determineTeams = function() {

		Object.keys(this.entities).filter(this.entities.movingFilter, this.entities).forEach(function(key) {

			var entity = this.entities[key];
			var name = entity.name.length > 0 ? entity.name : 'un-named';

			//if (entity.name.length > 0) {

			var teamKey = name + ' - ' + entity.color;
			var team = this.teams[teamKey];

			if (!team) {
				team = {
					cells : [],
					mass : 0
				};
				this.teams[teamKey] = team;
			}
			team.cells.push(entity);
			team.mass += entity.originalMass;
			//}
		}, this);

		Object.keys(this.teams).forEach(function(key) {

			var team = this.teams[key];

			if (team.cells.length == 1) {
				delete this.teams[key];
			} else {
				var circle = enclosingCircle(team.cells);
				team.x = circle.x;
				team.y = circle.y;
				team.size = circle.size;
				for (var i = 0; i < team.cells.length; i++) {
					var cell = team.cells[i];
					cell.teamSize = team.cells.length;
					cell.teamMass = team.mass;
				}
			}
		}, this);
	};

	this.determineMerges = function() {

		var keys = Object.keys(this.entities).filter(this.entities.mergeFilter, this.entities);

		for (var i = 0; i < keys.length; i++) {

			var entityA = this.entities[keys[i]];

			for (var b = i + 1; b < keys.length; b++) {

				var entityB = this.entities[keys[b]];

				if (Util.circlesIntersect(entityA, entityB, 0.1)) {

					var largerEntity = entityA.mass > entityB.mass ? entityA : entityB;

					largerEntity.mass = entityA.mass + entityB.mass;
					// newThreat.size = Math.sqrt(newThreat.mass * 100);
					drawCircle(largerEntity.x, largerEntity.y, largerEntity.size + 60, Constants.green);

				}
			}
		}
	};

	this.initializeEntities = function(player) {

		Object.keys(this.entities).forEach(function(key) {

			var entity = this.entities[key];

			entity.initialize(player);

		}, this);

		// needed for merge code
		for (var i = 0; i < player.cells.length; i++) {
			player.cells[i].classification = Classification.player;
		}
	};

	this.separateListBasedOnFunction = function(player) {

		Object.keys(this.entities).forEach(
				function(key) {

					var entity = this.entities[key];

					if (entity.isRemoved) { // hack until the isRemoved is fixed

						entity.classification = Classification.unknown;

					} else if (this.isItMe(player, entity)) {

						entity.classification = Classification.player;
						entity.velocity = entity.getVelocity(this.previousUpdated);

					} else if (this.isFood(player.smallestCell, entity)) {

						entity.classification = Classification.food;

					} else if (entity.isVirus(entity)) {

						entity.classification = Classification.virus;
						entity.foodList = [];
						entity.foodMass = 0;

					} else if (this.canEat(entity, player.smallestCell, Constants.enemyRatio)) {
						//} else if (this.canEat(entity, entity.closestCell, Constants.enemyRatio)) {

						entity.classification = Classification.threat;

					} else if (entity.closestCell.mass > 36
							&& this.canSplitKill(entity.closestCell, entity, Constants.playerRatio)) {

						entity.classification = Classification.food;
						//if (player.cells.length == 1 && player.mass / entity.mass < Constants.largeThreatRatio) {
						if (player.mass / entity.mass < Constants.largeThreatRatio * 2) {
							// split worthy
							entity.classification = Classification.splitTarget;
						}

					} else if (this.canEat(entity.closestCell, entity, Constants.playerRatio)) {

						entity.classification = Classification.food;

					} else {

						entity.classification = Classification.noThreat;

						if (player.cells.length > 1 && player.mass / entity.mass < 10) { // ?? mass check ?
							entity.classification = Classification.mergeTarget;
						}
					}

				}, this);
	};

	this.interceptPosition = function(source, target) {

		// http://stackoverflow.com/questions/2248876/2d-game-fire-at-a-moving-target-by-predicting-intersection-of-projectile-and-u

		function sqr(a) {
			return a * a;
		}

		var lastPos = target.getLastPos();

		target.velocityX = (target.x - lastPos.x);
		target.velocityY = (target.y - lastPos.y);

		var a = sqr(target.velocityX) + sqr(target.velocityY) - sqr(Constants.splitVelocity); // sqr(source.velocity * 8);
		target.interceptVelocity = a;

		var b = 2 * (target.velocityX * (target.x - source.x) + target.velocityY * (target.y - source.y));

		var c = sqr(target.x - source.x) + sqr(target.y - source.y);

		// Now we can look at the discriminant to determine if we have a possible solution.

		var disc = sqr(b) - 4 * a * c;

		// If the discriminant is less than 0, forget about hitting your target -- your projectile can never get there in time. Otherwise, look at two candidate solutions:

		if (disc < 0) {
			return null;
		}

		var t1 = (-b + Math.sqrt(disc)) / (2 * a);
		var t2 = (-b - Math.sqrt(disc)) / (2 * a);

		// Note that if disc == 0 then t1 and t2 are equal.

		// If there are no other considerations such as intervening obstacles, simply choose the smaller positive value. 
		// (Negative t values would require firing backward in time to use!)

		// Substitute the chosen t value back into the target's position equations to get the coordinates of the leading 
		// point you should be aiming at:

		var t = Math.max(t1, t2);

		var destination = {
			x : t * target.velocityX + target.x,
			y : t * target.velocityY + target.y
		};

		drawCircle(destination.x, destination.y, target.size, Constants.green);

		return destination;
	};

	this.clusterFood = function(player, blobSize) {
		player.foodClusters = [];

		Object.keys(this.entities).filter(this.entities.foodFilter, this.entities).forEach(function(key) {

			var food = this.entities[key];

			var addedCluster = false;

			if (food.hasMoved) {

				food.predictPosition(Constants.splitDuration, this.previousUpdated);

				// really should clone da
				player.foodClusters.push({
					x : food.px,
					y : food.py,
					size : food.size,
					mass : food.mass,
					cell : food,
					classification : Classification.cluster
				});
			} else {
				for (var j = 0; j < player.foodClusters.length; j++) {
					var cluster = player.foodClusters[j];

					if (!cluster.cell) {
						if (this.computeInexpensiveDistance(food.x, food.y, cluster.x, cluster.y) < blobSize * 2) {

							cluster.x = (food.x + cluster.x) / 2;
							cluster.y = (food.y + cluster.y) / 2;
							cluster.mass += food.mass;
							cluster.size = Math.sqrt(cluster.mass * 100);
							addedCluster = true;
							break;
						}
					}
				}
				if (!addedCluster) {
					player.foodClusters.push({
						x : food.x,
						y : food.y,
						size : food.size,
						mass : food.mass,
						cell : null,
						classification : Classification.cluster
					});
				}
			}
		}, this);
	};

	this.addFoodObstacles = function(player, obstacleList) {

		player.eachCellThreat(function(cell, threat) {

			// var distance = threat.size + threat.cell.size + threat.safeDistance;
			var distance = threat.size + cell.size
					+ (threat.isMovingTowards ? cell.size + threat.t.velocity : cell.size / 2 + threat.t.velocity);
			//drawCircle(threat.x, threat.y, distance, Constants.yellow);

			if (threat.distance < distance) {

				var tempOb = this.getAngleRange(cell, threat, 0, distance + cell.size, Classification.unknown);
				var angle1 = tempOb[0];
				var angle2 = this.rangeToAngle(tempOb);

				obstacleList.push([ [ angle1, true ], [ angle2, false ] ]);

				drawCircle(threat.x, threat.y, distance, Constants.yellow);
			}
		}, this);
	};

	this.getBestFood = function(player) {

		var i;

		for (i = 0; i < player.foodClusters.length; i++) {

			var cluster = player.foodClusters[i];
			var multiplier = 3;
			var weight = cluster.size; // shouldn't this be cluster.mass ?

			var closestInfo = player.closestCell(cluster.x, cluster.y);
			cluster.closestCell = closestInfo.cell;
			cluster.distance = closestInfo.distance;

			// if (!cluster.cell) {  // lets try not to follow enemies towards wall
			if ((cluster.x < getMapStartX() + 2000 && cluster.x < player.x)
					|| (cluster.y < getMapStartY() + 2000 && cluster.y < player.y)
					|| (cluster.x > getMapEndX() - 2000 && cluster.x > player.x)
					|| (cluster.y > getMapEndY() - 2000 && cluster.y > player.y)) {

				// everything close to the wall will seem very far away
				multiplier = 25;

			} else if (cluster.cell) {

				if (player.splitInfo && player.splitInfo.target && player.splitInfo.target == cluster.cell
						&& (Date.now() - player.splitInfo.timer) < 2000) {
					weight = weight * 4;
				}

				if ((player.cells.length == 1) && cluster.cell.isType(Classification.splitTarget)) {
					weight = weight * 1.5;
				}

				if ((player.cells.length > 1) && cluster.cell.isType(Classification.mergeTarget)) {
					weight = weight * 1.5;
				}

				if (player.safeToSplit && cluster.cell.isType(Classification.splitTarget) && this.inSplitRange(cluster)) {
					// weight = weight * 3;
					cluster.canSplitKill = true;
				}
				if (cluster.cell.isMovingTowards) {
					// prioritize enemies moving towards us
					weight = weight * 1.1;
				}

				weight *= Math.log(closestInfo.distance / 1000 * 20);
			}
			cluster.clusterWeight = closestInfo.distance / weight * multiplier;

			//drawPoint(cluster.x, cluster.y + 60, 1, "" + parseInt(cluster.clusterWeight, 10) + " "
			//		+ parseInt(cluster.size, 10));
		}

		var bestFoodI = 0;
		var bestClusterWeight = player.foodClusters[0].clusterWeight;
		for (i = 1; i < player.foodClusters.length; i++) {
			if (player.foodClusters[i].clusterWeight < bestClusterWeight) {
				if (!this.foodInVirus(player.foodClusters[i])) {
					bestClusterWeight = player.foodClusters[i].clusterWeight;
					bestFoodI = i;
				}
			}
		}
		return player.foodClusters[bestFoodI];
	};

	this.foodInVirus = function(food) {

		var keys = Object.keys(this.entities).filter(this.entities.virusFilter, this.entities);

		for (var i = 0; i < keys.length; i++) {

			var virus = this.entities[keys[i]];

			if (Util.circlesIntersect(food, virus)) {
				virus.foodMass += food.mass;
				virus.foodList.push(food);
				return true;
			}
		}

		return false;
	};

	this.calculateVirusMass = function(player) {

		Object.keys(this.entities).filter(this.entities.foodFilter, this.entities).forEach(function(key) {

			var food = this.entities[key];
			// increase virus mass if food is within
			if (food.isMoving) {
				this.foodInVirus(food);
			}
		}, this);

		Object.keys(this.entities).filter(this.entities.virusFilter, this.entities).forEach(function(key) {

			var virus = this.entities[key];

			if ((virus.closestCell.mass + virus.foodMass) / virus.mass > 1.2) {
				for (var j = 0; j < virus.foodList.length; j++) {
					var food = virus.foodList[j];
					//					if (!food.hasMoved) { // keep chasing cells in viruses - it's kinda funny
					food.classification = Classification.unknown;
					//					}
				}
			}
		}, this);
	};

	this.determineFoodDestination = function(player, destination) {

		var badAngles = [];
		var obstacleList = [];
		var goodAngles = [];
		var obstacleAngles = [];

		this.addVirusAngles(player, badAngles, obstacleList);
		this.addFoodObstacles(player, obstacleList);
		this.combineAngles(player, badAngles, obstacleList, goodAngles, obstacleAngles);

		this.clusterFood(player, player.largestCell.size);

		var i, j, cluster;

		// remove clusters within enemy split distance
		Object.keys(this.entities).filter(this.entities.splitThreatFilter, this.entities).forEach(
				function(key) {

					var threat = this.entities[key];

					for (j = player.foodClusters.length - 1; j >= 0; j--) {
						cluster = player.foodClusters[j];

						if (Util.computeDistance(threat.x, threat.y, cluster.x, cluster.y) < threat.size
								+ player.largestCell.size + Constants.splitRangeMax) {
							player.foodClusters.splice(j, 1);
						}
					}
				}, this);

		if (player.foodClusters.length === 0) {
			return false;
		}

		var doSplit = false; // (player.largestCell.mass >= 36 && player.mass <= 50 && player.cells.length == 1 && player.safeToSplit);

		cluster = this.getBestFood(player);

		// drawPoint(bestFood.x, bestFood.y, 1, "");
		if (cluster.canSplitKill && player.safeToSplit) {
			doSplit = true;
		}

		if (cluster.cell) {

			this.moreInfoStrings = [];
			this.moreInfoStrings.push("");
			this.moreInfoStrings.push("Target ===");

			this.moreInfoStrings.push("Mass: " + parseInt(cluster.mass, 10));
			this.moreInfoStrings.push("Moving: " + cluster.cell.isMoving ? "True" : "False");

			this.moreInfoStrings.push("");
		}

		// angle of food
		var angle = Util.getAngle(cluster.x, cluster.y, cluster.closestCell.x, cluster.closestCell.y);

		// angle away from obstacles
		var shiftedAngle = this.shiftAngle(obstacleAngles, angle, [ 0, 360 ]);

		if (player.cells.length == 1) {
			shiftedAngle = this.avoidObstacles(player, angle);
		}
		//this.avoidViruses(player, shiftedAngle);

		destination.point = this.followAngle(shiftedAngle.angle, cluster.closestCell.x, cluster.closestCell.y,
				cluster.distance);

		var color = Constants.orange;

		if (doSplit && shiftedAngle.shifted) {
			color = Constants.red; // cannot split, our angle was shifted from target
			doSplit = false;
		} else if (doSplit && !shiftedAngle.shifted) {

			if (cluster.cell) {
				if (this.obstaclesInPath(player, cluster)) {
					doSplit = false;
					color = Constants.red;
				}
			}
		}

		drawCircle(cluster.x, cluster.y, cluster.size + 40, color);
		drawPoint(cluster.x, cluster.y + 20, Constants.yellow, "m:" + cluster.mass.toFixed(1) + " w:"
				+ cluster.clusterWeight.toFixed(1));

		if (!doSplit && !shiftedAngle.shifted) {
			player.lure(cluster, destination);
		}

		// are we avoiding obstacles ??
		if (doSplit) {
			player.split(cluster, cluster.x, cluster.y, destination);
		}

		drawLine(cluster.closestCell.x, cluster.closestCell.y, destination.point.x, destination.point.y,
				Constants.orange);

		return true;
	};

	this.obstaclesInPath = function(player, target) {

		var keys = Object.keys(this.entities).filter(this.entities.threatAndVirusFilter, this.entities);

		// cell -> target
		var angle = Util.getAngle(target.closestCell.x, target.closestCell.y, target.x, target.y);

		for (var i = 0; i < keys.length; i++) {
			var entity = this.entities[keys[i]];

			if (entity.distance < target.distance) {

				for (var j = 0; j < player.cells.length; j++) {
					var cell = player.cells[j];

					var range = this.getRange(cell, entity);

					if (this.angleInRange(angle, range)) {
						this.drawAngledLine(player.x, player.y, range.left, 500, Constants.orange);
						this.drawAngledLine(player.x, player.y, range.right, 500, Constants.yellow);

						return true;
					}
				}
			}
		}
		return false;
	};

	this.setClosestVirus = function(player) {

		player.closestVirus = null;

		Object.keys(this.entities).filter(this.entities.virusFilter, this.entities).forEach(function(key) {
			var virus = this.entities[key];

			if (!player.closestVirus || virus.distance < player.closestVirus.distance) {
				player.closestVirus = virus;
			}

		}, this);
	};

	this.checkViruses = function(player, destination) {

		if (player.canShoot()) {

			Object.keys(this.entities).filter(this.entities.virusFilter, this.entities).forEach(function(key) {
				var virus = this.entities[key];

				if (virus.lastSize > virus.size && virus.distance - virus.closestCell.size < 300) {

					player.shootVirus(virus, destination);
					return true;
				}

			}, this);
		}
		return false;
	};

	this.displayVirusTargets = function(player) {

		if (player.closestVirus) {

			var virus = player.closestVirus;
			var numberOfShots = Math.floor((200 - virus.size) / 14);

			// incorrectly assuming all cells can hit virus
			if (player.canShoot(numberOfShots)) {

				for (var i = 0; i < player.cells.length; i++) {
					var cell = player.cells[i];

					if (virus.distance - cell.size < 500) { // arbitrary distance for now

						var angle = Math.atan2(cell.y - virus.y, cell.x - virus.x);

						var distance = virus.distance + cell.size + 500;

						var virusRange = {
							x : cell.x - Math.cos(angle) * distance,
							y : cell.y - Math.sin(angle) * distance,
						};

						drawLine(cell.x, cell.y, virusRange.x, virusRange.y, Constants.gray);
						drawCircle(virus.x, virus.y, Constants.virusShotDistance, Constants.orange);
					}
				}
			}
		}
	};

	this.calculateThreatWeight = function(player, t) {

		for (var i = 0; i < player.cells.length; i++) {

			var cell = player.cells[i];

			if (this.canEat(t, cell, Constants.playerRatio)) {

				var threat = {
					x : t.x,
					y : t.y,
					size : t.size,
					mass : t.mass,
					distance : Util.computeDistance(t.x, t.y, cell.x, cell.y),
					isMovingTowards : t.getMovingTowards(cell),
					cell : cell,
					angle : Math.atan2(t.y - cell.y, t.x - cell.x),
					threatLevel : 40,
					massLoss : cell.mass,
					teamSize : t.teamSize,
					isSplitThreat : false,
					t : t,
					safeDistance : t.safeDistance
				};

				t.futurePosition();
				threat.px = t.px;
				threat.py = t.py;
				/*
				var futureDistance = Util.computeDistance(t.px, t.py, cell.x, cell.y);

				if (futureDistance < threat.distance) {
					threat.x = t.px;
					threat.y = t.py;
					threat.distance = futureDistance;
				}
				*/

				// if the threat is moving towards any cell, mark this threat as moving towards us
				if (threat.isMovingTowards) {
					t.isMovingTowards = true;
				}

				var velocityPadding = cell.size < 50 ? cell.velocity : 0; // (t.velocity + cell.velocity);

				if (threat.isMovingTowards) {
					//					velocityPadding += t.velocity * 2;
				}
				threat.intersects = threat.distance < cell.size + t.size + velocityPadding;

				if (this.canSplitKill(t, cell, Constants.enemyRatio)
						&& t.teamMass / player.mass <= Constants.largeThreatRatio && t.teamSize < 6) {

					// this should really be 2 threats - maybe

					//threat.mass = t.mass / 2;
					//threat.size = Math.sqrt(threat.mass * 100);
					threat.isSplitThreat = true;
					t.isSplitThreat = true;
				}

				//threat.deathDistance = Math.min(threat.size - cell.size, threat.size); // how much overlap until we are eaten ??
				threat.deathDistance = threat.size; // ...
				threat.minDistance = threat.size + cell.size; // try just threat.size or death distance
				var notTouchingDistance = cell.size + threat.size;

				// too big - not a threat
				if (t.teamMass / player.mass > Constants.largeThreatRatio) {

					threat.preferredDistance = notTouchingDistance;
					threat.threatenedDistance = notTouchingDistance;

				} else if (threat.isSplitThreat) {

					threat.preferredDistance = notTouchingDistance + Constants.splitRangeMax;
					threat.threatenedDistance = notTouchingDistance + cell.size + Constants.splitRangeMax; // one radius distance

				} else {

					threat.preferredDistance = notTouchingDistance;
					threat.threatenedDistance = notTouchingDistance + cell.size; // one radius distance
				}

				threat.deathDistance += velocityPadding;
				threat.minDistance += velocityPadding;
				threat.preferredDistance += velocityPadding;
				threat.threatenedDistance += velocityPadding;

				if (threat.isMovingTowards) {
					threat.dangerZone = threat.threatenedDistance;
				} else {
					threat.dangerZone = threat.preferredDistance;
				}

				// drawPoint(threat.x, threat.y + 20, 2, parseInt(threat.distance, 10) + " " + parseInt(threat.dangerZone, 10));
				drawPoint(threat.x, threat.y + 20 + threat.size / 15, Constants.yellow, "/***" + "***\\ "
						+ parseInt(t.mass));

				cell.threats.push(threat);
				player.allThreats.push(threat);
			}
		}

	};

	this.pruneThreats = function(threats) {
		for (var i = threats.length - 1; i >= 0; i--) {
			var threat = threats[i];

			if (threat.distance < threat.dangerZone) {
				drawCircle(threat.x, threat.y, threat.threatenedDistance - threat.cell.size + 40, Constants.gray);
				threats.splice(i, 1);

				if (threats.length <= 1) {
					return true;
				}
			}
		}

		return false;
	};

	this.getUniqueThreats = function(threats) {
		var uniqueThreats = [];

		for (var i = 0; i < threats.length; i++) {
			uniqueThreats[threats[i].id] = threats[i];
		}
		return uniqueThreats.length;
	};

	this.reduceThreats = function(player, threats) {

		var i, threat;

		var uniqueThreats = this.getUniqueThreats(threats);

		if (threats.length <= 1 || uniqueThreats.length <= 1) {
			return;
		}

		// try reducing threatened distance
		/*
		for (i = 0; i < threats.length; i++) {
			threat = threats[i];

			threat.dangerZone = threat.safeDistance;
		}
		if (this.pruneThreats(threats)) {
			console.log('reduced distance');
			return;
		}
		*/

		// remove any threats not moving towards us
		for (i = threats.length - 1; i >= 0; i--) {
			threat = threats[i];

			if (threat.distance > threat.safeDistance && !threat.isMovingTowards) {
				drawCircle(threat.x, threat.y, threat.threatenedDistance - threat.cell.size + 40, Constants.gray);
				threats.splice(i, 1);
				console.log('not moving towards');
				if (threats.length <= 1 || this.getUniqueThreats(threats) <= 1) {
					return;
				}
			}
		}

		// remove any teams that must split to kill
		for (i = threats.length - 1; i >= 0; i--) {
			threat = threats[i];

			if (threat.teamSize > 1) {
				if (threat.distance > threat.safeDistance) {
					drawCircle(threat.x, threat.y, threat.threatenedDistance - threat.cell.size + 40, Constants.gray);
					threats.splice(i, 1);
					console.log('splitters');
					if (threats.length <= 1 || this.getUniqueThreats(threats) <= 1) {
						return;
					}
				}
			}
		}

		// reduce distance down to bare minimum
		/*
		for (i = 0; i < threats.length; i++) {
			threat = threats[i];

			threat.dangerZone = threat.minDistance;
		}
		if (this.pruneThreats(threats)) {
			console.log('bare minimum');
			return;
		}
		*/

		// save the biggest cell
		if (player.cells.length > 1) {

		}
	};

	this.addThreatAngles = function(player, badAngles) {

		var i = 0;

		player.eachCellThreat(function(cell, threat) {

			if (threat.distance < threat.dangerZone) {
				badAngles.push(this.getAngleRange(cell, threat, i++, threat.dangerZone, Classification.threat).concat(
						threat.distance));

				/*
				if (threat.intersects) {
					//badAngles.push(this.getAngleRange(threat.cell, threat, i, threat.size + threat.safeDistance,
					//		Classification.threat).concat(threat.distance));
					badAngles.push(this.getAngleRange(threat.cell, threat, i,
							threat.size - threat.cell.size + threat.safeDistance, Classification.threat).concat(
							threat.distance));
				} else {
				
					badAngles.push(this.getAngleRange(threat.cell, threat, i, threat.dangerZone, Classification.threat)
							.concat(threat.distance));
				}
				*/
			}
		}, this);
	};

	this.addVirusAngles = function(player, badAngles, obstacleList) {

		var i = 0;

		Object.keys(this.entities).filter(this.entities.virusFilter, this.entities).forEach(
				function(key) {

					var virus = this.entities[key];

					virus.range = null;

					for (var j = 0; j < player.cells.length; j++) {
						var cell = player.cells[j];

						if (virus.distance < cell.size + 750
								&& ((cell.mass + virus.foodMass) / virus.mass > 1.2 || player.isMerging)) {

							var minDistance = cell.size + cell.velocity;
							if (player.isMerging) {
								minDistance += cell.size;
							}

							var tempOb = this.getAngleRange(cell, virus, i, minDistance, Classification.unknown);
							var angle1 = tempOb[0];
							var angle2 = this.rangeToAngle(tempOb);
							obstacleList.push([ [ angle1, true ], [ angle2, false ] ]);

							virus.range = [ angle1, angle2 ];

							if (virus.distance < minDistance) {
								badAngles.push(tempOb.concat(minDistance));
							}
						}
					}
					i++;
				}, this);
	};

	this.combineAngles = function(player, badAngles, obstacleList, goodAngles, obstacleAngles) {

		var i, j, angle1, angle2, tempOb, line1, line2, diff, shiftedAngle, destination;
		var stupidList = [];

		if (badAngles.length > 0) {
			//NOTE: This is only bandaid wall code. It's not the best way to do it.
			stupidList = this.addWall(stupidList, player);
		}

		for (i = 0; i < badAngles.length; i++) {
			angle1 = badAngles[i][0];
			angle2 = this.rangeToAngle(badAngles[i]);
			stupidList.push([ [ angle1, true ], [ angle2, false ], badAngles[i][2] ]);
		}

		stupidList.sort(function(a, b) {
			return a[2] - b[2];
		});

		var sortedInterList = [];
		var sortedObList = [];

		for (i = 0; i < stupidList.length; i++) {

			var tempList = this.addAngle(sortedInterList, stupidList[i]);

			if (tempList.length === 0) {

				console.log("MAYDAY IT'S HAPPENING!");
				// break;
				return false;

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

		for (i = 0; i < sortedInterList.length; i += 2) {
			angle1 = sortedInterList[this.mod(i + offsetI, sortedInterList.length)][0];
			angle2 = sortedInterList[this.mod(i + 1 + offsetI, sortedInterList.length)][0];
			diff = this.mod(angle2 - angle1, 360);
			goodAngles.push([ angle1, diff ]);
		}

		for (i = 0; i < sortedObList.length; i += 2) {
			angle1 = sortedObList[this.mod(i + obOffsetI, sortedObList.length)][0];
			angle2 = sortedObList[this.mod(i + 1 + obOffsetI, sortedObList.length)][0];
			diff = this.mod(angle2 - angle1, 360);
			obstacleAngles.push([ angle1, diff ]);
		}
	};

	this.radiansToDegrees = function(angle) {
		return angle * 180 / Math.PI + 180;
	};

	this.degreesToRadiansHuh = function(degrees) {
		return degrees * Math.PI / 180;
	};

	this.degreesToRadians = function(degrees) {
		degrees -= 180;
		return degrees / (180 / Math.PI);
	};

	this.getRange = function(source, target) {

		var radius = target.size;

		//Alpha
		var a = Math.asin(radius / target.distance);
		//Beta
		var b = Math.atan2(target.y - source.y, target.x - source.x);
		//Tangent angle
		var t = b - a;

		var ta = {
			x : radius * Math.sin(t),
			y : radius * -Math.cos(t)
		};

		t = b + a;
		var tb = {
			x : radius * -Math.sin(t),
			y : radius * Math.cos(t)
		};

		return {
			left : Util.getAngle(target.x + ta.x, target.y + ta.y, source.x, source.y),
			right : Util.getAngle(target.x + tb.x, target.y + tb.y, source.x, source.y)
		};
	};

	this.showRanges = function(player) {

		Object.keys(this.entities).filter(this.entities.threatAndVirusFilter, this.entities).forEach(function(key) {
			var entity = this.entities[key];

			if (entity.closestCell.distance < entity.size + player.cells[0].size * 2) {

				var range = this.getSafeRange(player, entity, entity.size + player.cells[0].size);

				this.drawAngledLine(player.cells[0].x, player.cells[0].y, range.left, 500, Constants.orange);
				this.drawAngledLine(player.cells[0].x, player.cells[0].y, range.right, 500, Constants.yellow);
			}

		}, this);

	};

	//TODO: Don't let this function do the radius math.
	this.getSafeRange = function(blob1, blob2, radius) {

		var angle;
		var range = {
			inverted : false
		};

		var px = blob1.x;
		var py = blob1.y;

		var cx = blob2.x;
		var cy = blob2.y;

		var dx = cx - px;
		var dy = cy - py;
		var dd = Math.sqrt(dx * dx + dy * dy) + blob1.size; // distance + 1 radius (not touching)

		if (dd < radius) {
			range.inverted = true;
			radius = dd + (radius - dd);
		}

		var a = Math.asin(radius / dd);

		if (isNaN(a)) {
			console.log('it is NaN');
			angle = Util.getAngle(blob1.x, blob1.y, blob2.x, blob2.y);

			return {
				left : this.mod(angle + 1, 360),
				right : angle,
				inside : true
			};
		}

		var b = Math.atan2(dy, dx);
		if (range.inverted) {
			b = -b;
		}

		var t = b - a;
		var ta = {
			x : radius * Math.sin(t),
			y : radius * -Math.cos(t)
		};

		t = b + a;
		var tb = {
			x : radius * -Math.sin(t),
			y : radius * Math.cos(t)
		};

		range.left = Util.getAngle(cx + ta.x, cy + ta.y, px, py);
		range.right = Util.getAngle(cx + tb.x, cy + tb.y, px, py);

		return range;
	};

	this.angleInRange = function(angle, range) {

		if (range.right < range.left) {
			return !(angle >= range.right && angle <= range.left);
		}
		return angle >= range.left && angle <= range.right;
	};

	this.avoidObstacles = function(player, angle) {

		var shiftedAngle = {
			angle : angle,
			shifted : false
		};
		var ranges = [];

		this.addVirusObstacles(player);
		this.addThreatObstacles(player);

		for (var i = 0; i < player.allObstacles.length; i++) {

			var obstacle = player.allObstacles[i];

			var range = this.getSafeRange(obstacle.cell, obstacle.entity, obstacle.distance);

			this.drawAngledLine(obstacle.cell.x, obstacle.cell.y, range.left, 500, Constants.orange);
			this.drawAngledLine(obstacle.cell.x, obstacle.cell.y, range.right, 500, Constants.yellow);

			if (this.angleInRange(angle, range)) {
				ranges.push(range);

				shiftedAngle.shifted = true;
				shiftedAngle.angle = range.left;

				if (Math.abs(angle - range.left) > Math.abs(angle, range.right)) {
					shiftedAngle.angle = range.right;
				}

			}
		}

		return shiftedAngle;
	};

	this.addThreatObstacles = function(player) {

		player.eachCellThreat(function(cell, threat) {

			var distance = threat.size + cell.size + (cell.velocity + threat.t.velocity) * 2; // should use dangerZone

			if (threat.isMovingTowards) {
				distance += threat.t.velocity;
			}

			if (threat.distance < distance) {

				var obstacle = {
					entity : threat.t,
					cell : cell,
					distance : distance
				};
				cell.obstacles.push(obstacle);
				player.allObstacles.push(obstacle);
			}
		}, this);
	};

	this.addVirusObstacles = function(player) {

		Object.keys(this.entities).filter(this.entities.virusFilter, this.entities).forEach(function(key) {

			var virus = this.entities[key];

			for (var j = 0; j < player.cells.length; j++) {
				var cell = player.cells[j];

				if ((cell.mass + virus.foodMass) / virus.mass > 1.2 || player.isMerging) {

					var distance = cell.size + virus.size + cell.velocity;

					if (virus.distance < distance) {

						var obstacle = {
							entity : virus,
							cell : cell,
							distance : distance
						};

						cell.obstacles.push(obstacle);
						player.allObstacles.push(obstacle);
					}
				}
			}
		}, this);
	};

	this.computeDestinationAngle = function(player, destination) {

		var finalAngle = 0;
		var angles = [];

		for (var i = 0; i < player.cells.length; i++) {
			var cell = player.cells[i];

			var cellAngle = 0;
			var cellAngles = [];

			for (var j = 0; j < cell.threats.length; j++) {
				var threat = cell.threats[j];

				if (threat.distance < threat.dangerZone) {

					cellAngle += this.radiansToDegrees(threat.angle);
					cellAngles.push(threat.angle);
				}
			}
			if (cellAngles.length > 0) {

				cellAngle /= cellAngles.length;
				finalAngle += cellAngle;
				angles.push(cellAngle);
			}
		}

		if (angles.length > 0) {

			finalAngle /= angles.length;
		}

		finalAngle = this.avoidViruses(player, {
			angle : finalAngle,
			shifted : false
		});

		if (finalAngle !== 0) {
			var angle = this.degreesToRadians(finalAngle);
			destination.point.x = player.x - Math.cos(angle) * 1000;
			destination.point.y = player.y - Math.sin(angle) * 1000;
			this.drawAngledLine(player.x, player.y, finalAngle, 500, Constants.green);
		} else {
			console.log('no final angle');
		}
	};

	this.drawAngledLine = function(x, y, degrees, distance, color) {

		var angle = this.degreesToRadians(degrees);
		drawLine(x, y, x - Math.cos(angle) * distance, y - Math.sin(angle) * distance, color);
	};

	/**
	 * The bot works by removing angles in which it is too
	 * dangerous to travel towards to.
	 */
	this.avoidThreats = function(player, destination) {

		var badAngles = [];
		var obstacleList = [];
		var goodAngles = [];
		var obstacleAngles = [];

		this.addThreatAngles(player, badAngles);
		this.addVirusAngles(player, badAngles, obstacleList);
		this.combineAngles(player, badAngles, obstacleList, goodAngles, obstacleAngles);

		for (var i = 0; i < obstacleAngles.length; i++) {

			// this.drawAngle(player, obstacleAngles[i], 50, Constants.cyan);
		}

		if (goodAngles.length > 0) {
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

			// this.computeDestinationAngle(player, destination);

			destination.point = this.followAngle(perfectAngle.angle, player.x, player.y, verticalDistance());

			// this.adjustDestination(player, destination);

			return true;

		} else if (badAngles.length > 0 && goodAngles.length === 0) {

			return false;
		}

		this.determineFoodDestination(player, destination);
		return true;
	};

	this.determineBestDestination = function(player, destination, tempPoint) {

		var i, j;
		var panicLevel = 0;
		var threat;

		// panic levels:
		// 2 = partially inside a threat
		// 1 = in the split distance of a threat

		player.allThreats = [];
		player.allObstacles = [];

		Object.keys(this.entities).filter(this.entities.threatFilter, this.entities).forEach(function(key) {

			threat = this.entities[key];

			threat.velocity = threat.getVelocity(this.previousUpdated);
			var velocity = (threat.velocity + threat.closestCell.velocity);
			threat.safeDistance = velocity;

			this.calculateThreatWeight(player, threat);

			if (player.cells.length == 1) {
				// this.predictPosition(threat, 200);
				if (threat.distance < threat.size + player.largestCell.size * 0.75 && threat.velocity > 20) {
					console.log('splitting due to near death');
					player.split(null, 0, 0, destination);
				}
			}

		}, this);

		var imminentThreatCount = 0;
		var intersectCount = 0;
		var overlappedBy = null;

		player.eachCellThreat(function(cell, threat) {

			if (threat.distance < threat.dangerZone) {
				// only increment if it is a different threat (not the same threat for 2 different cells)
				if (!overlappedBy) {
					overlappedBy = threat;
					imminentThreatCount++;
				} else if (threat.t != overlappedBy.t) {
					imminentThreatCount++;
				}
			}

			if (threat.intersects) {
				intersectCount++;
			}
		}, this);

		var evasionStrategy = null;

		if (intersectCount > 0) {
			evasionStrategy = player.intersectEvasionStrategy;
		} else if (imminentThreatCount >= 1 && imminentThreatCount <= 2) {
			evasionStrategy = player.singleThreatEvasionStrategy;
		} else if (imminentThreatCount > 1) {
			evasionStrategy = player.multiThreatEvasionStrategy;
		}

		//var angle;
		//var count = threats.length;
		//this.reduceThreats(player, threats);
		//if (threats.length < count) {
		//	console.log("was: " + count + " now: " + threats.length);
		//}
		/*
		if (threats.length > 1) {
			console.log('didnt reduce threats: ' + threats.length);
		}
		*/

		/*
		for (i = 0; i < threats.length; i++) {
			threat = threats[i];
			var color = Constants.red;
			if (threat.dangerZone < threat.preferredDistance) {
				color = Constants.orange;
			}
			drawCircle(threat.x, threat.y, threat.dangerZone, color);
		}
		*/
		if (evasionStrategy) {

			evasionStrategy.call(player);
		}

		if (!this.avoidThreats(player, destination)) {

			player.eachCellThreat(function(cell, threat) {
				threat.dangerZone = threat.minDistance;
			});

			console.log('trying again to determine destination');
			if (!this.avoidThreats(player, destination)) {
				console.log('could not determine destination');
			}
		}
	};

	/**
	 * This is the main bot logic. This is called quite often.
	 * @return A 2 dimensional array with coordinates for every cells.  [[x, y], [x, y]]
	 */
	this.mainLoop = function(cells) {

		if (!this.initialized) {
			this.initialized = true;
			initializeEntity();
		}

		this.infoStrings = [];

		var player = this.player;
		this.player.setCells(cells);

		for (var i = 0; i < player.cells.length; i++) {
			var cell = player.cells[i];

			cell.threats = [];
			cell.obstacles = [];
		}

		var destination = this.update(cells);

		this.updateInfo(this.player);
		this.previousUpdated = getLastUpdate();

		Object.keys(this.entities).forEach(function(key) {

			var entity = this.entities[key];

			entity.lastX = entity.x;
			entity.lastY = entity.y;
			entity.lastSize = entity.size;

		}, this);

		return destination;
	};

	this.update = function(cells) {

		var player = this.player;
		var destination = {
			point : new Point(getPointX(), getPointY()),
			split : false,
			shoot : false,
			override : false
		};

		this.teams = [];
		this.entities = getMemoryCells();

		var useMouseX = screenToGameX(getMouseX());
		var useMouseY = screenToGameY(getMouseY());
		var tempPoint = [ useMouseX, useMouseY, 1 ];

		//The current destination that the cells were going towards.

		drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX()
				+ (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), Constants.gray);
		drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), getX()
				+ (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), Constants.gray);
		drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX()
				- (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), Constants.gray);
		drawLine(getX() + (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX()
				+ (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), Constants.gray);

		drawCircle(player.x, player.y, player.size + Constants.enemySplitDistance, Constants.pink);

		//loop through everything that is on the screen and
		//separate everything in it's own category.

		this.initializeEntities(player);
		if (!isHumanControlled()) {
			this.determineMerges();
		}

		this.separateListBasedOnFunction(player);
		this.setClosestVirus(player);
		this.displayVirusTargets(player);
		
		this.showRanges(player);

		if (player.action && player.action(destination)) {
			return destination;
		}

		if (!isHumanControlled()) {
			if (this.checkViruses(player, destination)) {
				return destination;
			}
		}

		if (!isHumanControlled()) {
			this.determineTeams();
			player.isSafeToSplit(this.entities);
			player.checkIfMerging();
			// this.calculateVirusMass(player);

			this.determineBestDestination(player, destination, tempPoint);
		}

		if (player.safeToSplit) {
			drawCircle(player.x, player.y, player.size + 16, Constants.green);
		}

		Object.keys(this.entities).forEach(function(key) {

			var entity = this.entities[key];

			switch (entity.classification) {
			case Classification.player:
				// drawPoint(entity.x, entity.y + 20, 1, entity.mass.toFixed(2));
				break;
			case Classification.virus:
				drawCircle(entity.x, entity.y, entity.size + 300, Constants.orange);
				drawPoint(entity.x, entity.y, 1, entity.mass.toFixed(2));
				break;
			case Classification.splitTarget:
				drawCircle(entity.x, entity.y, entity.size + 20, Constants.green);
				break;
			case Classification.mergeTarget:
				drawCircle(entity.x, entity.y, entity.size + 20, Constants.cyan);
				break;
			case Classification.food:
				// drawPoint(entity.x, entity.y+20, 1, entity.mass.toFixed(2));
				if (entity.hasMoved) {
					drawCircle(entity.x, entity.y, entity.size + 20, Constants.blue);
				} else if (entity.size > 14) {
					drawPoint(entity.x, entity.y + 20, Constants.white, entity.size);
					drawCircle(entity.x, entity.y, entity.size + 20, Constants.cyan);
				}
				break;
			case Classification.unknown:
				drawCircle(entity.x, entity.y, entity.size + 20, Constants.purple);
				break;
			case Classification.threat:
				//drawPoint(entity.x, entity.y + 20, 1, parseInt(entity.distance - entity.size));
				var color = entity.isMovingTowards ? Constants.red : Constants.orange;
				drawCircle(entity.x, entity.y, entity.size + 20, color);

				//drawCircle(entity.x, entity.y, entity.dangerZone, color);
				break;
			}
		}, this);

		player.eachCellThreat(function(cell, threat) {

			if (threat.isSplitThreat) {

				var tsize = Math.sqrt(threat.mass / 2 * 100);
				var shadowDistance = Math.min(threat.t.size + Constants.splitRangeMax, threat.distance);

				var shadowThreat = {
					x : threat.t.x - Math.cos(threat.angle) * shadowDistance,
					y : threat.t.y - Math.sin(threat.angle) * shadowDistance,
				};
				// distance = Util.computeDistance(shadowThreat.x, shadowThreat.y, cell.x, cell.y);

				drawCircle(shadowThreat.x, shadowThreat.y, tsize, Constants.gray);

				var shadowLineDistance = Math.min(threat.t.size - tsize + Constants.splitRangeMax, threat.distance);
				var shadowThreatLine = {
					x : threat.t.x - Math.cos(threat.angle) * shadowLineDistance,
					y : threat.t.y - Math.sin(threat.angle) * shadowLineDistance,
				};

				drawLine(threat.t.x, threat.t.y, shadowThreatLine.x, shadowThreatLine.y,
						threat.isMovingTowards ? Constants.red : Constants.gray);
			}
		}, this);

		Object.keys(this.teams).forEach(function(key) {

			var team = this.teams[key];

			drawCircle(team.x, team.y, team.size, Constants.cyan);
		}, this);

		// cursor
		// drawPoint(tempPoint[0], tempPoint[1], tempPoint[2], "");

		return destination;
	};

	this.updateInfo = function(player) {
		this.infoStrings.push("");
		this.infoStrings.push("Player Mass: " + parseInt(player.mass, 10));
		this.infoStrings.push("Player Size: " + parseInt(player.size, 10));
		this.infoStrings.push("Player Velocity: " + parseInt(player.smallestCell.velocity, 10));
		this.infoStrings.push("Player Angle: " + player.cells[0].getMovementAngle());
		/*
		if (player.cells.length > 1) {
			this.infoStrings.push("Player Min:  " + parseInt(player.smallestCell.size, 10));
			this.infoStrings.push("Player Max:  " + parseInt(player.largestCell.size, 10));
		}
		*/
		this.infoStrings.push("");

		for (var i = 0; i < player.cells.length; i++) {

			var cell = player.cells[i];
			var cellInfo = "Cell " + i + " Mass: " + parseInt(cell.mass, 10);
			if (cell.fuseTimer) {
				cellInfo += "   Fuse: " + parseInt((cell.fuseTimer - Date.now()) / 1000, 10);
			}
			this.infoStrings.push(cellInfo);
		}
		var offsetX = -getMapStartX();
		var offsetY = -getMapStartY();
		this.infoStrings.push("Location: " + Math.floor(player.x + offsetX) + ", " + Math.floor(player.y + offsetY));

		this.infoStrings.push("");
	};

	this.displayText = function() {

		var i;

		var debugStrings = [ "Q - Follow Mouse: " + (this.toggleFollow ? "On" : "Off") ];
		for (i = 0; i < this.infoStrings.length; i++) {
			debugStrings.push(this.infoStrings[i]);
		}
		for (i = 0; i < this.moreInfoStrings.length; i++) {
			debugStrings.push(this.moreInfoStrings[i]);
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
		var dist = Util.computeDistance(cell1.x, cell1.y, cell2.x, cell2.y, cell1.size, cell2.size);

		return dist <= -5; // was -50
	};

	// Get a distance that is Inexpensive on the cpu for various purpaces
	this.computeInexpensiveDistance = function(x1, y1, x2, y2) {

		var xdis = x1 - x2;
		var ydis = y1 - y2;
		// Get abs quickly
		xdis = xdis < 0 ? xdis * -1 : xdis;
		ydis = ydis < 0 ? ydis * -1 : ydis;

		var distance = xdis + ydis;

		return distance;
	};

	this.isItMe = function(player, cell) {
		if (getMode() == ":teams") {
			var currentColor = player.cells[0].color;
			var currentRed = currentColor.substring(1, 3);
			var currentGreen = currentColor.substring(3, 5);
			var currentBlue = currentColor.substring(5, 7);

			var currentTeam = this.getTeam(currentRed, currentGreen, currentBlue);

			var cellColor = cell.color;

			var cellRed = cellColor.substring(1, 3);
			var cellGreen = cellColor.substring(3, 5);
			var cellBlue = cellColor.substring(5, 7);

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

		if (!cell.isMoving() && !cell.isVirus() && this.canEat(blob, cell, Constants.playerRatio)) {
			return true;
		}
		return false;
	};

	this.canEat = function(eater, eatee, ratio) {
		if (eater.mass > eatee.mass) {
			return eater.mass / eatee.mass > ratio;
		}
		return false;
	};

	// can i split and eat someone
	this.canSplitKill = function(eater, eatee, ratio) {

		if (eater.mass > eatee.mass) {
			return (eater.mass / 2) / eatee.mass > ratio;
		}
		return false;
	};

	this.getTimeToRemerge = function(mass) {
		return ((mass * 0.02) + 30);
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

		return [ new Point(newX1, newY1), new Point(newX2, newY2) ];
	};

	this.drawAngle = function(cell, angle, distance, color) {
		var line1 = this.followAngle(angle[0], cell.x, cell.y, distance + cell.size);
		var line2 = this.followAngle(this.mod(angle[0] + angle[1], 360), cell.x, cell.y, distance + cell.size);

		drawLine(cell.x, cell.y, line1.x, line1.y, color);
		drawLine(cell.x, cell.y, line2.x, line2.y, color);

		drawArc(line1.x, line1.y, line2.x, line2.y, cell.x, cell.y, color);

		//drawPoint(cell[0].x, cell[0].y, 2, "");

		drawPoint(line1.x, line1.y, Constants.red, parseInt(angle[0], 10));
		drawPoint(line2.x, line2.y, Constants.red, parseInt(angle[1], 10));
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
		var mainAngle = Util.getAngle(blob1.x, blob1.y, blob2.x, blob2.y);
		var leftAngle = this.mod(mainAngle - 90, 360);
		var rightAngle = this.mod(mainAngle + 90, 360);

		var blob1Left = this.followAngle(leftAngle, blob1.x, blob1.y, blob1.size);
		var blob1Right = this.followAngle(rightAngle, blob1.x, blob1.y, blob1.size);

		var blob2Left = this.followAngle(rightAngle, blob2.x, blob2.y, blob2.size);
		var blob2Right = this.followAngle(leftAngle, blob2.x, blob2.y, blob2.size);

		var blob1AngleLeft = Util.getAngle(blob2.x, blob2.y, blob1Left.x, blob1Left.y);
		var blob1AngleRight = Util.getAngle(blob2.x, blob2.y, blob1Right.x, blob1Right.y);

		var blob2AngleLeft = Util.getAngle(blob1.x, blob1.y, blob2Left.x, blob2Left.y);
		var blob2AngleRight = Util.getAngle(blob1.x, blob1.y, blob2Right.x, blob2Right.y);

		var blob1Range = this.mod(blob1AngleRight - blob1AngleLeft, 360);
		var blob2Range = this.mod(blob2AngleRight - blob2AngleLeft, 360);

		var tempLine = this.followAngle(blob2AngleLeft, blob2Left.x, blob2Left.y, 400);
		//drawLine(blob2Left[0], blob2Left[1], tempLine[0], tempLine[1], 0);

		if ((blob1Range / blob2Range) > 1) {
			drawPoint(blob1Left.x, blob1Left.y, Constants.red, "");
			drawPoint(blob1Right.x, blob1Right.y, Constants.red, "");
			drawPoint(blob1.x, blob1.y, Constants.red, "" + blob1Range + ", " + blob2Range + " R: "
					+ (Math.round((blob1Range / blob2Range) * 1000) / 1000));
		}

		//drawPoint(blob2.x, blob2.y, 3, "" + blob1Range);
	};

	//TODO: Don't let this function do the radius math.
	this.getEdgeLinesFromPoint = function(blob1, blob2, radius, dontInvert) {
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

		if (!dontInvert) {
			var tempRadius = Util.computeDistance(px, py, cx, cy);
			if (tempRadius <= radius) {
				radius = tempRadius - 5;
				//radius = tempRadius - 1;
			}
		}

		var dx = cx - px;
		var dy = cy - py;
		var dd = Math.sqrt(dx * dx + dy * dy);
		var a = Math.asin(radius / dd);
		var b = Math.atan2(dy, dx);

		var t = b - a;
		var ta = {
			x : radius * Math.sin(t),
			y : radius * -Math.cos(t)
		};

		t = b + a;
		var tb = {
			x : radius * -Math.sin(t),
			y : radius * Math.cos(t)
		};

		var angleLeft = Util.getAngle(cx + ta.x, cy + ta.y, px, py);
		var angleRight = Util.getAngle(cx + tb.x, cy + tb.y, px, py);
		var angleDistance = this.mod(angleRight - angleLeft, 360);

		/*if (shouldInvert) {
		    var temp = angleLeft;
		    angleLeft = this.mod(angleRight + 180, 360);
		    angleRight = this.mod(temp + 180, 360);
		    angleDistance = this.mod(angleRight - angleLeft, 360);
		}*/

		return [ angleLeft, angleDistance, [ cx + tb.x, cy + tb.y ], [ cx + ta.x, cy + ta.y ] ];
	};

	this.addWall = function(listToUse, blob) {

		var lineLeft, lineRight;
		//var mapSizeX = Math.abs(f.getMapStartX - f.getMapEndX);
		//var mapSizeY = Math.abs(f.getMapStartY - f.getMapEndY);
		//var distanceFromWallX = mapSizeX/3;
		//var distanceFromWallY = mapSizeY/3;
		var distanceFromWallY = blob.size + 50; // originally 2000
		var distanceFromWallX = blob.size + 50; // originally 2000
		if (blob.x < getMapStartX() + distanceFromWallX) {
			//LEFT
			//console.log("Left");
			listToUse.push([ [ 115, true ], [ 245, false ],
					this.computeInexpensiveDistance(getMapStartX(), blob.y, blob.x, blob.y) ]);
			lineLeft = this.followAngle(115, blob.x, blob.y, 190 + blob.size);
			lineRight = this.followAngle(245, blob.x, blob.y, 190 + blob.size);
			drawLine(blob.x, blob.y, lineLeft.x, lineLeft.y, Constants.gray);
			drawLine(blob.x, blob.y, lineRight.x, lineRight.y, Constants.gray);
			drawArc(lineLeft.x, lineLeft.y, lineRight.x, lineRight.y, blob.x, blob.y, Constants.pink);
		}
		if (blob.y < getMapStartY() + distanceFromWallY) {
			//TOP
			//console.log("TOP");
			listToUse.push([ [ 205, true ], [ 335, false ],
					this.computeInexpensiveDistance(blob.x, getMapStartY(), blob.x, blob.y) ]);
			lineLeft = this.followAngle(205, blob.x, blob.y, 190 + blob.size);
			lineRight = this.followAngle(335, blob.x, blob.y, 190 + blob.size);
			drawLine(blob.x, blob.y, lineLeft.x, lineLeft.y, Constants.gray);
			drawLine(blob.x, blob.y, lineRight.x, lineRight.y, Constants.gray);
			drawArc(lineLeft.x, lineLeft[1], lineRight.x, lineRight.y, blob.x, blob.y, Constants.pink);
		}
		if (blob.x > getMapEndX() - distanceFromWallX) {
			//RIGHT
			//console.log("RIGHT");
			listToUse.push([ [ 295, true ], [ 65, false ],
					this.computeInexpensiveDistance(getMapEndX(), blob.y, blob.x, blob.y) ]);
			lineLeft = this.followAngle(295, blob.x, blob.y, 190 + blob.size);
			lineRight = this.followAngle(65, blob.x, blob.y, 190 + blob.size);
			drawLine(blob.x, blob.y, lineLeft.x, lineLeft.y, Constants.gray);
			drawLine(blob.x, blob.y, lineRight.x, lineRight.y, Constants.gray);
			drawArc(lineLeft.x, lineLeft.y, lineRight.x, lineRight.y, blob.x, blob.y, Constants.pink);
		}
		if (blob.y > getMapEndY() - distanceFromWallY) {
			//BOTTOM
			//console.log("BOTTOM");
			listToUse.push([ [ 25, true ], [ 155, false ],
					this.computeInexpensiveDistance(blob.x, getMapEndY(), blob.x, blob.y) ]);
			lineLeft = this.followAngle(25, blob.x, blob.y, 190 + blob.size);
			lineRight = this.followAngle(155, blob.x, blob.y, 190 + blob.size);
			drawLine(blob.x, blob.y, lineLeft.x, lineLeft.y, Constants.gray);
			drawLine(blob.x, blob.y, lineRight.x, lineRight.y, Constants.gray);
			drawArc(lineLeft.x, lineLeft.y, lineRight.x, lineRight.y, blob.x, blob.y, Constants.pink);
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

		removeList.sort(function(a, b) {
			return b - a;
		});

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

	this.getAngleRange = function(blob1, blob2, index, radius, classification, dontInvert) {

		var angleStuff = this.getEdgeLinesFromPoint(blob1, blob2, radius, dontInvert);
		var leftAngle = angleStuff[0];
		var rightAngle = this.rangeToAngle(angleStuff);
		var difference = angleStuff[1];
		var safeDistance = blob1.size + blob2.size;

		if (classification != Classification.unknown) {

			drawPoint(angleStuff[2][0], angleStuff[2][1], Constants.red, "");
			drawPoint(angleStuff[3][0], angleStuff[3][1], Constants.red, "");

			//console.log("Adding badAngles: " + leftAngle + ", " + rightAngle + " diff: " + difference);

			var lineLeft = this.followAngle(leftAngle, blob1.x, blob1.y, safeDistance - index * 10);
			var lineRight = this.followAngle(rightAngle, blob1.x, blob1.y, safeDistance - index * 10);

			var color = Constants.orange;
			if (classification == Classification.virus) {
				color = Constants.cyan;
			} else if (classification == Classification.threat) { // (getCells().hasOwnProperty(blob2.id)) {
				color = Constants.red;
			} else if (classification == Classification.cluster) {
				color = Constants.green;
			}

			drawLine(blob1.x, blob1.y, lineLeft.x, lineLeft.y, color);
			drawLine(blob1.x, blob1.y, lineRight.x, lineRight.y, color);
			drawArc(lineLeft.x, lineLeft.y, lineRight.x, lineRight.y, blob1.x, blob1.y, color);
		}
		return [ leftAngle, difference ];
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
						return {
							angle : angle1,
							shifted : true
						};
					}
					return {
						angle : angle2,
						shifted : true
					};
				}

				if (this.angleIsWithin(angle2, range)) {
					return {
						angle : angle2,
						shifted : true
					};
				}
				return {
					angle : angle1,
					shifted : true
				};
			}
		}
		//console.log("No Shifting Was needed!");
		return {
			angle : angle,
			shifted : false
		};
	};
	this.inSplitRange = function(cluster) {

		var interceptPoint = this.interceptPosition(cluster.cell.closestCell, cluster.cell);

		if (!interceptPoint) {
			return false;
		}
		var range = Constants.splitRangeMin;

		if (cluster.cell.isMovingTowards) {
			range = Constants.splitRangeMax;
		}

		var distance = Util.computeDistance(cluster.cell.closestCell.x, cluster.cell.closestCell.y, interceptPoint.x,
				interceptPoint.y);

		if (distance < range) {
			cluster.x = interceptPoint.x;
			cluster.y = interceptPoint.y;
			return true;
		}

		return false;
	};
}

function randomizedList(array) {
	var i, n = (array = array.slice()).length, head = null, node = head;
	while (n) {
		var next = {
			id : array.length - n,
			value : array[n - 1],
			next : null
		};
		if (node)
			node = node.next = next;
		else
			node = head = next;
		array[i] = array[--n];
	}
	return {
		head : head,
		tail : node
	};
}
// Returns the smallest circle that contains the specified circles.
function enclosingCircle(circles) {
	return enclosingCircleIntersectingCircles(randomizedList(circles), []);
}
// Returns the smallest circle that contains the circles L
// and intersects the circles B.
function enclosingCircleIntersectingCircles(L, B) {
	var circle, l0 = null, l1 = L.head, l2, p1;
	switch (B.length) {
	case 1:
		circle = B[0];
		break;
	case 2:
		circle = circleIntersectingTwoCircles(B[0], B[1]);
		break;
	case 3:
		circle = circleIntersectingThreeCircles(B[0], B[1], B[2]);
		break;
	}
	while (l1) {
		p1 = l1.value, l2 = l1.next;
		if (!circle || !circleContainsCircle(circle, p1)) {
			// Temporarily truncate L before l1.
			if (l0)
				L.tail = l0, l0.next = null;
			else
				L.head = L.tail = null;
			B.push(p1);
			circle = enclosingCircleIntersectingCircles(L, B); // Note: reorders L!
			B.pop();
			// Move l1 to the front of L and reconnect the truncated list L.
			if (L.head)
				l1.next = L.head, L.head = l1;
			else
				l1.next = null, L.head = L.tail = l1;
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
	var xc0 = circle1.x - circle2.x, yc0 = circle1.y - circle2.y;
	return Math.sqrt(xc0 * xc0 + yc0 * yc0) < circle1.size - circle2.size + 1e-6;
}
// Returns the smallest circle that intersects the two specified circles.
function circleIntersectingTwoCircles(circle1, circle2) {
	var x1 = circle1.x, y1 = circle1.y, r1 = circle1.size, x2 = circle2.x, y2 = circle2.y, r2 = circle2.size, x12 = x2
			- x1, y12 = y2 - y1, r12 = r2 - r1, l = Math.sqrt(x12 * x12 + y12 * y12);
	return {
		x : (x1 + x2 + x12 / l * r12) / 2,
		y : (y1 + y2 + y12 / l * r12) / 2,
		size : (l + r1 + r2) / 2
	};
}
// Returns the smallest circle that intersects the three specified circles.
function circleIntersectingThreeCircles(circle1, circle2, circle3) {
	var x1 = circle1.x, y1 = circle1.y, r1 = circle1.size, x2 = circle2.x, y2 = circle2.y, r2 = circle2.size, x3 = circle3.x, y3 = circle3.y, r3 = circle3.size, a2 = 2 * (x1 - x2), b2 = 2 * (y1 - y2), c2 = 2 * (r2 - r1), d2 = x1
			* x1 + y1 * y1 - r1 * r1 - x2 * x2 - y2 * y2 + r2 * r2, a3 = 2 * (x1 - x3), b3 = 2 * (y1 - y3), c3 = 2 * (r3 - r1), d3 = x1
			* x1 + y1 * y1 - r1 * r1 - x3 * x3 - y3 * y3 + r3 * r3, ab = a3 * b2 - a2 * b3, xa = (b2 * d3 - b3 * d2)
			/ ab - x1, xb = (b3 * c2 - b2 * c3) / ab, ya = (a3 * d2 - a2 * d3) / ab - y1, yb = (a2 * c3 - a3 * c2) / ab, A = xb
			* xb + yb * yb - 1, B = 2 * (xa * xb + ya * yb + r1), C = xa * xa + ya * ya - r1 * r1, r = (-B - Math
			.sqrt(B * B - 4 * A * C))
			/ (2 * A);
	return {
		x : xa + xb * r + x1,
		y : ya + yb * r + y1,
		size : r
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
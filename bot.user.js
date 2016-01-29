'use strict';

/* jshint -W097 */
/* jshint browser: true, laxbreak: true */
/* global console, $ */
/* global drawPoint, drawLine, drawCircle, drawArc, getModek, getMapStartX, getMapStartY */
/* global getPointX, getPointY, getMapEndX, getMapEndY, getMouseX, getMouseY */
/* global getZoomlessRatio, verticalDistance, getPlayer, screenToGameX, screenToGameY */
/* global getX, getY, getMemoryCells, getCells, getMode, getLastUpdate, isHumanControlled */
/* global setHumanControlled, getEverything, getRatio */

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
// @version     3.1863
// @grant       none
// @author      http://www.twitch.tv/apostolique
// ==/UserScript==
var aposBotVersion = 3.1863;

var Constants = {

	splitRangeMin : 650,
	splitRangeMax : 700, // 674.5,
	playerRatio : 1.285,
	enemyRatio : 1.27,
	splitDuration : 1000, // 800 was pretty good
	splitVelocity : 150,
	mergeFactor : 0.025,

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
	playerSpeed : 60, // was 30 - Player base speed (seems like 72ish to me)

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
//      In team mode, make allies be obstacles.

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

	this.splitFor = null;

	this.lureTimer = Date.now();
};

Player.prototype = {

	setCells : function(cells, entities) {

		var i, cell;

		this.cells = cells;
		this.isAlive = this.cells.length > 0;
		this.mass = 0;
		this.smallestCell = cells[0];
		this.largestCell = cells[0];

		for (i = 0; i < cells.length; i++) {
			cell = cells[i];

			cell.mass = cell.size * cell.size / 100;
			cell.isMe = true;
			cell.splitDistance = cell.getSplitDistance();

			this.mass = this.mass + cell.mass;

			if (cell.size < this.smallestCell.size) {
				this.smallestCell = cell;
			}
			if (cell.size > this.largestCell.size) {
				this.largestCell = cell;
			}

		}

		for (i = 0; i < cells.length; i++) {
			cell = cells[i];

			if (!cell.fuseTimer) {
				cell.fuseTimer = Date.now(); //  + (30 + cell.mass * 0.02) * 1000;
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
	isSafeToSplit : function(entities, aggressionLevel) {

		this.safeToSplit = false;

		if (aggressionLevel == 1) {
			this.safeToSplit = this.cells.length == 1;

		} else if (aggressionLevel == 2) {
			this.safeToSplit = this.cells.length <= 2;

		} else if (aggressionLevel > 2) {
			this.safeToSplit = true;
		}

		Object.keys(entities).forEach(
				function(key) {

					var entity = entities[key];
					// if any largish enemies are within our split radius, don't allow split
					if (!entity.isVirus() && entity.size > 14 && !entity.isType(Classification.player)) {

						if (entity.closestCell.size * entity.closestCell.size / 2 < entity.size * entity.size
								* Constants.enemyRatio) {
							//if (entity.distance < entity.size + entity.closestCell.size) {
							if (entity.distance < 750 + entity.closestCell.size) {
								this.safeToSplit = false;
							}
						}
					}
				}, this);

		return this.safeToSplit;
	},
	canMerge : function() {
		for (var i = 1; i < this.cells.length; i++) {
			if (this.cells[i].getFuseTime() < 0) {
				return true;
			}
		}
		return false;
	},
	merge : function() {

		if (this.cells.length > 1) {

			this.mergeInfo = {
				cellCount : this.cells.length,
				x : Math.floor(this.x),
				y : Math.floor(this.y),
				timer : Date.now()
			};
			this.action = this.mergeAction;
		}
	},
	mergeAction : function(destination) {

		if (this.cells.length >= this.mergeInfo.cellCount && Date.now() - this.mergeInfo.timer < 2000) {

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
	canShootCount : function() {

		var count = 0;

		for (var i = 0; i < this.cells.length; i++) {
			var cell = this.cells[i];

			if (cell.mass > 34) {

				count++;
			}
		}
		return count;
	},
	mergeMass : function() {

		if (this.action !== null || this.cells.length < 3 || this.size > this.largestCell.size * 2.5
				|| this.canShootCount() < 3 || this.largestCell.size < 100) {
			return;
		}

		for (var i = 0; i < this.cells.length; i++) {
			var cell = this.cells[i];

			if (cell.threatened) {

				this.action = this.mergeMassAction;
				this.mergeMassInfo = {
					timer : 0,
					cell : cell
				};
			}
		}
	},
	mergeMassAction : function(destination) {

		var info = this.mergeMassInfo;

		if (Date.now() - info.timer > 100) {

			if (this.canShootCount() < 3) {

				this.action = null;
				return false;
			}

			destination.shoot = true;
			info.timer = Date.now();
		}

		var clone = this.cells.slice(0);

		clone.sort(function(a, b) {
			return b.size - a.size;
		});

		// could break if largest cell gets eaten during this action

		var nextLargestCell = clone[0];
		for (var i = 0; i < this.cells.length; i++) {
			var cell = this.cells[i];

			if (cell != info.cell) {
				nextLargestCell = cell;
			}
		}

		if (nextLargestCell.size < 50) {
			this.action = null;
			return false;
		}

		// point to largest cell - mouse pos half radius distance on largest cell towards next largest
		var angle = Util.getAngle(nextLargestCell, info.cell);
		destination.point = Util.pointFromAngle(info.cell.x, info.cell.y, angle, info.cell.size / 2);

		return true;
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

		if (this.canSplit()) {

			this.splitInfo = {
				target : null,
				size : Math.floor(this.size),
				timer : Date.now() + 1000,
				point : null
			};

			this.action = this.splitAction;
			destination.split = true;

			if (cluster) {

				this.splitInfo.target = cluster.cell.id;

				this.splitFor = {
					x : cluster.x,
					y : cluster.y,
					size : cluster.size
				};

				console.log('split for');
				console.log(cluster.cell);

				this.splitInfo.point = new Point(cluster.closestCell.x + (x - cluster.closestCell.x) * 4,
						cluster.closestCell.y + (y - cluster.closestCell.y) * 4);

				destination.point = this.splitInfo.point;
			}
		}
	},
	hasSplit : function() {
		for (var i = 0; i < this.cells.length; i++) {
			if (this.cells[i].lastSize === null) {
				return true;
			}
		}
		return false;
	},
	splitAction : function(destination, entities) {

		var info = this.splitInfo;

		if (!info.hasSplit) {
			info.hasSplit = this.hasSplit();
		}

		if (info.hasSplit && Math.floor(this.size) <= this.splitInfo.size || Date.now() > this.splitInfo.timer
				|| info.target && !entities[info.target]) {
			this.action = null;
			return false;
		}

		info.size = Math.floor(this.size);

		if (info.target) {

			destination.point = info.point;
		}

		return true;
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
	shootVirusAction : function(destination, entities) {

		var info = this.virusShootInfo;
		var virus = info.virus;

		if (virus.distance > virus.closestCell.size && this.canShoot(1) && entities[virus.id]) {

			var cell = virus.closestCell;
			var distance = virus.distance;

			var virusAngle = Util.getAngle(virus, cell);
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
	singleThreatEvasionStrategy : function() {
		// angle away from the closest threat and the next closest threat (if within range)

		drawCircle(this.x, this.y, this.size + 16, Constants.pink);

		if (this.allThreats.length > 1) {

			this.allThreats.sort(function(a, b) {
				return Math.max(a.distance - a.dangerZone, 0) - Math.max(b.distance - b.dangerZone, 0);
			});

			for (var i = 1; i < this.allThreats.length; i++) {
				var threat = this.allThreats[i];

				if (threat.entity != this.allThreats[0].entity) {

					if (threat.distance - threat.dangerZone < 250) {
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

function Range(left, right, distance) {

	this.left = Util.mod(left);
	this.right = Util.mod(right);
	this.distance = distance;

	this.angleWithin = function(angle) {

		if (this.right < this.left) {
			return !(angle > this.right && angle < this.left);
		}
		return angle >= this.left && angle <= this.right;
	};

	this.size = function() {

		if (this.left > this.right) {
			return (360 - this.left) + this.right + 1;
		}

		return this.right - this.left + 1;
	};

	this.overlaps = function(range) {

		if (this.size() > range.size()) {
			return this.angleWithin(range.left) || this.angleWithin(range.right);
		}
		return range.angleWithin(this.left) || range.angleWithin(this.right);
	};

	this.denormalize = function() {
		if (this.left > this.right) {
			this.right += 360;
		}
	};

	this.normalize = function() {
		this.left = Util.mod(this.left);
		this.right = Util.mod(this.right);
	};

	this.combine = function(range) {

		if (this.overlaps(range)) {

			this.denormalize();
			range.denormalize();

			if (range.right < this.left) {
				range.left += 360;
				range.right += 360;
			} else if (this.right < range.left) {
				this.left += 360;
				this.right += 360;
			}

			this.left = Math.min(this.left, range.left);
			this.right = Math.max(this.right, range.right);
			this.distance = Math.min(this.distance, range.distance);

			if (this.right - this.left > 359) {
				this.right = this.left - 1;
			}
			this.normalize();
			range.normalize();

			return true;
		}
		return false;
	};

	this.getMidpoint = function() {

		return Util.mod(this.left + this.size() / 2);
	};

	this.getInverseMidpoint = function() {

		var diff = (360 - this.size()) / 2;
		return Util.mod(this.right + diff);
	};
}

var Util = function() {
};

// Using mod function instead the prototype directly as it is very slow
Util.mod = function(x) {
	while (x < 0) {
		x += 360;
	}
	while (x > 360) {
		x -= 360;
	}
	return x;
};

Util.angleDiff = function(angle1, angle2) {

	var diff = Util.mod(angle1 - angle2);
	if (diff > 180) {
		diff = 360 - diff;
	}
	return diff;
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

// angle of point 1 in relation to point 2
Util.getAngle = function(target, source) {

	var result = Math.round(Math.atan2(-(target.y - source.y), -(target.x - source.x)) / Math.PI * 180 + 180);

	if (target.x == source.x) {
		if (target.y == source.y) {
			result = 180;
		} else if (target.y < source.y) {
			result = 270;
		} else {
			result = 90;
		}
	} else if (target.y == source.y) {
		if (target.x < source.x) {
			result = 180;
		} else {
			result = 360;
		}
	}

	var result2 = Math.round(Math.atan2(source.y - target.y, source.x - target.x) * 180 / Math.PI + 180);

	if (result != result2) {
		console.log([ result, result2 ]);
		console.log([ target.x, target.y, source.x, source.y ]);
	}
	return result;
};

Util.degreesToRadians = function(degrees) {
	degrees -= 180;
	return degrees / (180 / Math.PI);
};

Util.radiansToDegrees = function(angle) {
	return angle * 180 / Math.PI + 180;
};

Util.pointFromAngle = function(x, y, angle, distance) {
	var radians = this.degreesToRadians(angle);

	return {
		x : x - Math.cos(radians) * distance,
		y : y - Math.sin(radians) * distance
	};
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
		this.teamSize = 1;
		this.teamMass = this.mass;
		this.isSplitThreat = false;
		this.isLargeThreat = false;
		this.velocity = this.getSpeed(); // this.getVelocity();

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

	da.prototype.canEat = function(eatee, ratio) {
		return this.mass > eatee.mass && this.mass / eatee.mass > ratio;
	};

	da.prototype.isType = function(classification) {
		return this.classification == classification;
	};

	da.prototype.getSpeed = function() {
		return Constants.playerSpeed * Math.pow(this.mass, -1.0 / 4.5) * 50 / 40;
	};

	da.prototype.getSplitDistance = function() {
		return (4 * (this.getSpeed() * 5)) + (this.size * 1.75);
	};

	da.prototype.getFuseTime = function() {
		var fuseTime = (30 + this.mass * Constants.mergeFactor) * 1000;
		return fuseTime - (Date.now() - this.fuseTimer);
	};

	da.prototype.getMovingTowards = function(target) {

		if (!this.hasMoved) {
			return false;
		}

		var a = this.getLastPos();

		var range = new Range(Util.getAngle(a, this), Util.getAngle(this, target));

		// hmm - 360 - 5 ??
		return range.size() < 30 || range.size() > 330; // within 30 degrees
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
		//var lastPos = this.getLastPos();

		//return Util.computeDistance(this.x, this.y, lastPos.x, lastPos.y);

		if (!this.hasMoved) {
			return 0;
		}
		return Math.max(40, (this.size - 50) / 4);
	};

	da.prototype.getVelocity2 = function() {

		var dx = this.J - this.s;
		var dy = this.K - this.t;

		return Math.sqrt(dx * dx + dy * dy); // distance + 1 radius (not touching)
	};

	da.prototype.getMovementAngle = function() {

		var lastPos = this.getLastPos();

		return Util.getAngle(this, lastPos);
	};

	da.prototype.getAngle = function(target) {
		return Util.getAngle(this, target);
	};

	var entitiesPrototype = Object.getPrototypeOf(getCells());

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
	entitiesPrototype.nonPlayerFilter = function(key) {

		var entity = this[key];

		if (entity.isType(Classification.player) || entity.isType(Classification.unknown)) {
			return false;
		}
		return true;
	};
}

console.log("Apos Bot!");

window.botList = window.botList || [];

function AposBot() {
	this.name = "AposBot " + aposBotVersion;

	this.initialized = false;
	this.noProcessing = false;
	this.toggleFollow = false;
	this.verticalDistance = false;
	this.aggressionLevel = 1;
	this.infoStrings = [];
	this.moreInfoStrings = [];
	this.previousUpdated = Date.now();
	this.keyAction = function(key) {
		if (81 == key.keyCode) { // 'q'
			this.toggleFollow = !this.toggleFollow;
		} else if (key.keyCode == 86) { // 'v: vertical distance'
			this.verticalDistance = !this.verticalDistance;
		} else if (key.keyCode == 69) { // 'e: eject virus'
			this.player.ejectVirus();
		} else if (key.keyCode == 77) { // 'm: merge'
			this.player.merge();
		} else if (key.keyCode == 76) { // 'l: lower aggression'
			this.aggressionLevel = Math.max(0, this.aggressionLevel - 1);
		} else if (key.keyCode == 80) { // 'p: no processing'
			this.noProcessing = !this.noProcessing;
			setHumanControlled(this.noProcessing);
		} else if (key.keyCode == 65) { // 'a: raise aggression'
			this.aggressionLevel = Math.min(3, this.aggressionLevel + 1);
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

					if (typeof entity.isMe != "undefined") {
						// ignore
						entity.classification = Classification.player;

					} else if (entity.isRemoved) { // hack until the isRemoved is fixed

						entity.classification = Classification.unknown;

					} else if (this.isItMe(player, entity)) {

						entity.classification = Classification.player;
						//entity.velocity = entity.getVelocity(this.previousUpdated);

					} else if (this.isFood(player.smallestCell, entity)) {

						entity.classification = Classification.food;

					} else if (entity.isVirus(entity)) {

						if (player.cells.length == 16) {
							if (entity.closestCell.canEat(entity, Constants.playerRatio)) {
								entity.classification = Classification.food;
							} else {
								entity.classification = Classification.noThreat; // this is not quite right - need to be able to shoot viruses
							}
						} else {
							entity.classification = Classification.virus;
							entity.foodList = [];
							entity.foodMass = 0;
						}

					} else if (entity.canEat(player.smallestCell, Constants.enemyRatio)) {
						//} else if (this.canEat(entity, entity.closestCell, Constants.enemyRatio)) {

						entity.classification = Classification.threat;

					} else if (entity.closestCell.mass > 36
							&& this.canSplitKill(entity.closestCell, entity, Constants.playerRatio)) {

						entity.classification = Classification.food;

						var largeThreatRatio = Constants.largeThreatRatio;
						if (this.aggressionLevel > 1) {
							largeThreatRatio *= 2;
						}
						//if (player.cells.length == 1 && player.mass / entity.mass < Constants.largeThreatRatio) {
						if (player.mass / entity.mass < largeThreatRatio) {
							// split worthy
							entity.classification = Classification.splitTarget;
						}

					} else if (entity.closestCell.canEat(entity, Constants.playerRatio)) {

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

		// starting speed is 6 times player speed ending in 1 time
		// so the speed needed is 6 - (6 / (750 / distance)) * player speed

		function sqr(a) {
			return a * a;
		}

		var lastPos = target.getLastPos();

		var angle = Math.atan2(lastPos.y - target.y, lastPos.x - target.x);

		target.velocityX = -Math.cos(angle) * Constants.playerSpeed;
		target.velocityY = -Math.sin(angle) * Constants.playerSpeed;

		this.drawAngledLine(target.x, target.y, Util.radiansToDegrees(angle), 300, Constants.red);

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

	this.getBestFood = function(player, range) {

		var i, cluster;
		var keys = Object.keys(this.entities).filter(this.entities.threatFilter, this.entities);
		var angle = player.cells[0].getMovementAngle();

		for (i = 0; i < player.foodClusters.length; i++) {

			cluster = player.foodClusters[i];
			var multiplier = 1;
			var weight = cluster.mass; // shouldn't this be cluster.mass ?
			var probability = 1;

			var closestInfo = player.closestCell(cluster.x, cluster.y);
			cluster.closestCell = closestInfo.cell;
			cluster.distance = closestInfo.distance;
			cluster.angle = Util.getAngle(cluster, cluster.closestCell);

			var angleDiff = Util.angleDiff(angle, cluster.angle);

			var distance = cluster.distance + (Constants.playerSpeed * 2) * (angleDiff / 180); // add in turn around distance

			// if (!cluster.cell) {  // lets try not to follow enemies towards wall
			if ((cluster.x < getMapStartX() + 2000 && cluster.x < player.x)
					|| (cluster.y < getMapStartY() + 2000 && cluster.y < player.y)
					|| (cluster.x > getMapEndX() - 2000 && cluster.x > player.x)
					|| (cluster.y > getMapEndY() - 2000 && cluster.y > player.y)) {

				// everything close to the wall will seem very far away
				multiplier = 25;

			} else if (cluster.cell) {

				if (cluster.cell.isType(Classification.splitTarget)) {
					cluster.canSplitKill = true;
				}

				if ((player.cells.length == 1) && cluster.cell.isType(Classification.splitTarget)) {
					probability = 2;
					if (cluster.distance < 700) {
						probability = 5;
					}
				}

				if ((player.cells.length > 1) && cluster.cell.isType(Classification.mergeTarget)) {
					probability = 1.2;
				}

				if (cluster.cell.isMovingTowards) {
					// prioritize enemies moving towards us
					probability = probability * 1.1;
				}
				// weight *= Math.log(closestInfo.distance / 1000 * 20);
			} else {
				probability = 4;
			}

			cluster.clusterWeight = distance / (cluster.mass * probability) * multiplier;

			for (var j = 0; j < keys.length; j++) {

				var entity = this.entities[keys[j]];

				if (entity.range.angleWithin(cluster.angle)) {
					cluster.clusterWeight *= entity.riskFactor;
				}
			}

			drawPoint(cluster.x, cluster.y + 60, 1, parseInt(cluster.clusterWeight, 10));
		}

		var bestCluster = null;

		for (i = 1; i < player.foodClusters.length; i++) {
			cluster = player.foodClusters[i];

			if (!bestCluster || cluster.clusterWeight < bestCluster.clusterWeight) {
				if (this.isFoodValid(player, cluster, range)) {
					bestCluster = cluster;
				}
			}
		}
		return bestCluster;
	};

	this.isFoodValid = function(player, cluster, range) {

		if (range) {
			var angle = Util.getAngle(cluster, cluster.closestCell);
			if (!range.angleWithin(angle)) {
				return false;
			}
		}

		if (this.foodInVirus(cluster)) {
			return false;
		}

		// remove clusters within enemy split distance
		var keys = Object.keys(this.entities).filter(this.entities.splitThreatFilter, this.entities);

		for (var i = 0; i < keys.length; i++) {

			var threat = this.entities[keys[i]];

			if (Util.computeDistance(threat.x, threat.y, cluster.x, cluster.y) < threat.splitDistance) {
				return false;
			}
		}
		return true;
	};

	this.angleInRanges = function(angle, ranges) {

		for (var i = 0; i < ranges.length; i++) {
			var range = ranges[i];

			if (range.angleWithin(angle)) {
				return true;
			}
		}
		return false;
	};

	this.angleInThreatRanges = function(angle, ranges) {

		for (var i = 0; i < ranges.length; i++) {
			var range = ranges[i];

			if (range.classification == Classification.threat && range.angleWithin(angle)) {
				return true;
			}
		}
		return false;
	};

	this.foodInVirus = function(food) {

		var keys = Object.keys(this.entities).filter(this.entities.virusFilter, this.entities);

		for (var i = 0; i < keys.length; i++) {

			var virus = this.entities[keys[i]];

			if (Util.circlesIntersect(food, virus)) {
				virus.foodMass += food.mass;
				virus.foodList.push(food);
				drawCircle(food.x, food.y, food.size + 5, Constants.red);
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

	this.getBestRange = function(ranges) {

		if (ranges.length === 0) {
			return null;
		}

		if (ranges.length == 1) {
			return new Range(ranges[0].right + 1, ranges[0].left - 1);
		}

		ranges.sort(function(a, b) {
			return a.left - b.left;
		});

		var left = ranges[0].right + 1;
		var goodRanges = [];
		for (var i = 1; i < ranges.length; i++) {
			var range = ranges[i];
			goodRanges.push(new Range(left, range.left - 1));
			left = range.right + 1;
		}
		goodRanges.push(new Range(left, ranges[0].left - 1));

		goodRanges.sort(function(a, b) {
			return b.size() - a.size();
		});

		return goodRanges[0];
	};

	this.shouldSplitKill = function(player, cluster) {

		if (!this.inSplitRange(cluster)) {
			return false;
		}

		if (this.aggressionLevel > 2) {
			this.safeToSplit = false;

			if (this.aggressionLevel > 2 || player.cells.length <= 2) {
				if ((player.largestCell.mass / 2) / cluster.mass > 1) {
					return true;
				}
			}
		}
		return player.isSafeToSplit(this.entities, this.aggressionLevel);
	};

	this.determineFoodDestination = function(player, destination, ranges) {

		this.clusterFood(player, player.largestCell.size);

		if (player.foodClusters.length === 0) {
			return false;
		}

		var range = this.getBestRange(ranges);

		if (range) {
			var size = range.size() / 4;
			range.left = Util.mod(range.left + size);
			range.right = Util.mod(range.right - size);

			this.drawRange(player.x, player.y, player.size + 100, range, 0, Constants.green);

			var midPoint = range.getMidpoint();
			destination.point = this.followAngle(midPoint, player.x, player.y, verticalDistance());
		}

		var doSplit = false; // (player.largestCell.mass >= 36 && player.mass <= 50 && player.cells.length == 1 && player.safeToSplit);

		// refactor...
		player.isSafeToSplit(this.entities);

		var cluster = this.getBestFood(player, range);

		if (cluster === null) {
			if (range) {
				drawLine(player.x, player.y, destination.point.x, destination.point.y, Constants.red);
				return true;
			}
			return false;
		}

		// drawPoint(bestFood.x, bestFood.y, 1, "");
		if (cluster.canSplitKill) { //  && player.safeToSplit) {
			doSplit = this.shouldSplitKill(player, cluster);
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
		var angle = Util.getAngle(cluster, cluster.closestCell);

		if (this.angleInThreatRanges(angle, ranges)) {
			if (range) {
				drawLine(player.x, player.y, destination.point.x, destination.point.y, Constants.red);
				return true;
			}
			console.log('wtf');
			return false;
		}

		// angle away from obstacles
		var shiftedAngle = this.avoidObstacles(player, angle, cluster.distance);

		var distance = ranges.length > 0 ? verticalDistance() : cluster.distance;

		destination.point = Util.pointFromAngle(cluster.closestCell.x, cluster.closestCell.y, shiftedAngle.angle,
				this.verticalDistance ? verticalDistance() : distance);

		if (this.angleInRanges(shiftedAngle.angle, ranges)) {
			if (range) {
				drawLine(player.x, player.y, destination.point.x, destination.point.y, Constants.red);
				return true;
			}
			console.log('not shifting');
			console.log([ angle, shiftedAngle.angle ]);
			console.log(ranges);
			console.log(range);
			return false;
		}

		var color = Constants.orange;

		if (doSplit && shiftedAngle.shifted) {
			color = Constants.red; // cannot split, our angle was shifted from target
			doSplit = false;
		} else if (doSplit && !shiftedAngle.shifted) {

			if (cluster.cell) {
				if (this.obstaclesInPath(cluster.closestCell, cluster)) {
					doSplit = false;
					color = Constants.red;
				}
			}
		}

		drawCircle(cluster.x, cluster.y, cluster.size + 40, color);
		//		drawPoint(cluster.x, cluster.y + 20, Constants.yellow, "m:" + cluster.mass.toFixed(1) + " w:"
		//				+ cluster.clusterWeight.toFixed(1));
		drawPoint(cluster.x, cluster.y + 20, Constants.yellow, angle + " " + cluster.closestCell.getMovementAngle());
		// "m:" + cluster.mass.toFixed(1) + " w:" + cluster.clusterWeight.toFixed(1));

		drawPoint(player.x + player.size, player.y + player.size, Constants.yellow, Util.getAngle(new Point(player.x
				+ player.size, player.y + player.size), player));

		drawPoint(player.x - player.size, player.y + player.size, Constants.yellow, Util.getAngle(new Point(player.x
				- player.size, player.y + player.size), player));

		if (!doSplit && !shiftedAngle.shifted) {
			player.lure(cluster, destination);
		}

		// are we avoiding obstacles ??
		if (doSplit) {
			player.split(cluster, cluster.x, cluster.y, destination);
		}

		drawLine(player.x, player.y, destination.point.x, destination.point.y, Constants.green);

		//drawLine(cluster.closestCell.x, cluster.closestCell.y, destination.point.x, destination.point.y,
		//		Constants.green);

		if (shiftedAngle.shifted) {

			drawLine(cluster.closestCell.x, cluster.closestCell.y, cluster.x, cluster.y, Constants.orange);
		}

		return true;
	};

	this.drawSimpleRange = function(pt, range, distance, color) {

		this.drawAngledLine(pt.x, pt.y, range.left, distance, color);
		this.drawAngledLine(pt.x, pt.y, range.right, distance, color);
	};

	this.isSplitKillable = function(entity) {

	};

	this.obstaclesInPath = function(cell, target) {

		var hasObstacles = false;
		var threatMass = (cell.mass / 2) * 1.25; // threat if larger than this

		var range = this.getRange(cell, target);

		var keys = Object.keys(this.entities).filter(this.entities.nonPlayerFilter, this.entities);
		for (var i = 0; i < keys.length; i++) {
			var entity = this.entities[keys[i]];

			if (entity.mass > threatMass || entity.isType(Classification.virus)) {
				var distance = Util.computeDistance(cell.x, cell.y, entity.x, entity.y);

				if (distance - target.size < 700) {
					var threatRange = this.getRange(cell, entity);

					if (range.overlaps(threatRange)) {
						this.drawSimpleRange(cell, threatRange, distance, Constants.red);
						hasObstacles = true;
					} else {
						this.drawSimpleRange(cell, threatRange, distance, Constants.gray);
					}
				}
			}
		}

		return hasObstacles;
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

				if (virus.size > virus.lastSize && virus.distance - virus.closestCell.size < 300) {

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

	this.calculateThreatWeight = function(player, entity) {

		var threat;

		for (var i = 0; i < player.cells.length; i++) {

			var cell = player.cells[i];

			/*
			if (virus.size + cell.size > virus.distance) {
				console.log("v: " + ((virus.size + cell.size) - virus.distance));
			}
			*/

			if (entity.classification == Classification.virus) {

				if (cell.mass > entity.mass * 1.25) {

					var distance = cell.size + entity.size + cell.velocity; // ??? cell.velocity;

					threat = {
						classification : entity.classification,
						x : entity.x,
						y : entity.y,
						size : entity.size,
						mass : entity.mass,
						distance : Util.computeDistance(entity.x, entity.y, cell.x, cell.y),
						isMovingTowards : false,
						cell : cell,
						angle : cell.getAngle(entity),
						threatLevel : 40,
						massLoss : 0,
						teamSize : 1,
						isSplitThreat : false,
						isLargeThreat : false,
						entity : entity,
						deathDistance : cell.size,
						minDistance : distance,
						preferredDistance : distance,
						threatenedDistance : distance,
						dangerZone : distance,
					};

					threat.intersects = threat.distance < cell.size + entity.size;

					cell.threats.push(threat);
					player.allThreats.push(threat);
				}

			} else if (entity.canEat(cell, Constants.playerRatio)) {

				threat = {
					classification : entity.classification,
					x : entity.x,
					y : entity.y,
					size : entity.size,
					mass : entity.mass,
					distance : Util.computeDistance(entity.x, entity.y, cell.x, cell.y),
					isMovingTowards : entity.getMovingTowards(cell),
					cell : cell,
					angle : cell.getAngle(entity),
					threatLevel : 40,
					massLoss : cell.mass,
					teamSize : entity.teamSize,
					isSplitThreat : false,
					isLargeThreat : false,
					entity : entity
				};

				entity.futurePosition();
				threat.px = entity.px;
				threat.py = entity.py;
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
					entity.isMovingTowards = true;
				}

				var velocityPadding = cell.velocity; // (t.velocity + cell.velocity);

				if (threat.isMovingTowards) {
					velocityPadding += entity.velocity;
				}
				threat.intersects = threat.distance < cell.size + entity.size + velocityPadding;

				if (this.canSplitKill(entity, cell, Constants.enemyRatio)
						&& entity.teamMass / player.mass <= Constants.largeThreatRatio && entity.teamSize < 6) {

					// this should really be 2 threats - maybe

					//threat.mass = t.mass / 2;
					//threat.size = Math.sqrt(threat.mass * 100);
					threat.isSplitThreat = entity.isSplitThreat = true;
					threat.splitDistance = entity.splitDistance = entity.getSplitDistance();
				}

				//threat.deathDistance = Math.min(threat.size - cell.size, threat.size); // how much overlap until we are eaten ??
				threat.deathDistance = threat.size; // ...
				threat.minDistance = threat.size + cell.size; // try just threat.size or death distance
				var notTouchingDistance = cell.size + threat.size;

				// too big - not a threat
				if (entity.teamMass / player.mass > Constants.largeThreatRatio) {

					threat.isLargeThreat = entity.isLargeThreat = true;

					threat.preferredDistance = notTouchingDistance;
					threat.threatenedDistance = notTouchingDistance;

				} else if (threat.isSplitThreat) {

					threat.preferredDistance = threat.splitDistance;
					threat.threatenedDistance = cell.size + threat.splitDistance; // one radius distance

				} else {

					threat.preferredDistance = notTouchingDistance;
					threat.threatenedDistance = notTouchingDistance + cell.size; // one radius distance
				}

				threat.deathDistance += velocityPadding;
				threat.minDistance += velocityPadding;
				threat.preferredDistance += velocityPadding;
				threat.threatenedDistance += velocityPadding;

				if (threat.isMovingTowards) {
					threat.preferredDistance = threat.threatenedDistance;
				}
				threat.dangerZone = threat.preferredDistance;

				// drawPoint(threat.x, threat.y + 20, 2, parseInt(threat.distance, 10) + " " + parseInt(threat.dangerZone, 10));
				drawPoint(threat.x, threat.y + 20 + threat.size / 15, Constants.yellow, "/***" + "***\\ ");
				drawPoint(threat.x, threat.y + 40 + threat.size / 15, Constants.yellow, parseInt(entity.mass), 24);

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

	this.getMinimumRange = function(source, target) {

		//		var radius = target.size;
		var radius = target.size - (source.size * 0.4); // 200 - (100 * .4) = 160 --> min distance
		// Eating range = radius of eating cell + 40% of the radius of the cell being eaten

		//Alpha
		var a = Math.asin(radius / target.distance);
		if (isNaN(a)) {
			console.log('it is NaN ' + radius + ' ' + source.distance);
			a = 1;
		}
		//Beta
		var b = Math.atan2(target.y - source.y, target.x - source.x);
		//Tangent angle
		var t = b - a;

		var diff = Util.radiansToDegrees(b - t);
		b = Util.radiansToDegrees(b);

		return new Range(Util.mod(b - diff), Util.mod(b + diff), target.distance);
	};

	this.get180Range = function(angle, distance) {
		return new Range(Util.mod(angle - 90), Util.mod(angle + 90), distance);
	};

	this.getRange = function(source, target) {

		var radius = target.size;

		//Alpha
		var a = Math.asin(radius / target.distance);
		if (isNaN(a)) {
			console.log('it is NaN ' + radius + ' ' + target.distance);
			a = 1;
		}
		//Beta
		var b = Math.atan2(target.y - source.y, target.x - source.x);
		//Tangent angle
		var t = b - a;

		var diff = Util.radiansToDegrees(b - t);
		b = Util.radiansToDegrees(b);

		return new Range(Util.mod(b - diff), Util.mod(b + diff), target.distance);
	};

	//TODO: Don't let this function do the radius math.
	this.getSafeRange = function(blob1, blob2, radius) {

		var inverted = false;

		var dx = blob2.x - blob1.x;
		var dy = blob2.y - blob1.y;
		var dd = Math.sqrt(dx * dx + dy * dy); // distance + 1 radius (not touching)

		if (dd < radius) {
			inverted = true;
			dd = radius + (radius - dd);
		}

		var a = Math.asin(radius / dd);

		if (isNaN(a)) {
			console.log('getSafeRange NaN');
			console.log([ dd, radius ]);
			console.log(blob2);
			var angle = Util.getAngle(blob2, blob1);
			this.drawAngledLine(blob1.x, blob1.y, angle, 500, Constants.cyan);

			return new Range(angle, Util.mod(angle + 1), dd);
		}

		var b = Math.atan2(dy, dx);
		var t = b - a;
		var diff = Util.radiansToDegrees(b - t);

		b = Util.radiansToDegrees(b);

		if (inverted) {
			diff = 270 + (270 - diff);
		}

		return new Range(Util.mod(b - diff), Util.mod(b + diff), dd);
	};

	this.avoidObstacles = function(player, angle, distance) {

		var shiftedAngle = {
			angle : angle,
			shifted : false
		};

		player.allThreats.sort(function(a, b) {
			return Math.max(a.distance - a.dangerZone, 0) - Math.max(b.distance - b.dangerZone, 0);
		});

		var i, range, ranges = [];

		for (i = 0; i < player.allThreats.length; i++) {

			var threat = player.allThreats[i];

			if (threat.distance - threat.dangerZone > distance) {
				break;
			}

			range = this.getSafeRange(threat.cell, threat.entity, threat.dangerZone);

			this.addRange(ranges, range);

			// drawCircle(threat.x, threat.y, threat.dangerZone, Constants.yellow);
		}

		for (i = 0; i < ranges.length; i++) {
			range = ranges[i];

			if (range.angleWithin(angle)) {

				var diffLeft = Util.angleDiff(angle, range.left);
				var diffRight = Util.angleDiff(angle, range.right);
				var diff = Math.min(diffLeft, diffRight);

				// should add / subtract 1 from the angle

				shiftedAngle.shifted = true;
				shiftedAngle.angle = Util.mod(range.left + 1);

				if (diffLeft > diffRight) {
					shiftedAngle.angle = Util.mod(range.right - 1);
				}
				break;
			}
		}

		return shiftedAngle;
	};

	this.addRange = function(ranges, range) {

		for (var i = 0; i < ranges.length; i++) {

			var testRange = ranges[i];

			if (testRange.combine(range)) {

				ranges.splice(testRange, 1);

				this.addRange(ranges, testRange);
				return false; // wasn't added - just combined with existing
			}
		}

		ranges.push(range);
		return true; // range added
	};

	this.drawAngledLine = function(x, y, degrees, distance, color) {

		var radians = Util.degreesToRadians(degrees);
		drawLine(x, y, x - Math.cos(radians) * distance, y - Math.sin(radians) * distance, color);
	};

	/**
	 * The bot works by removing angles in which it is too
	 * dangerous to travel towards to.
	 */
	this.avoidThreats = function(player) {

		var allRanges = [];
		var angles = [], angle;
		var i;

		for (i = 0; i < player.allThreats.length; i++) {

			var threat = player.allThreats[i];

			if (threat.distance < threat.dangerZone) {
				var distance = Math.max(threat.dangerZone - threat.distance, 0);
				angles.push({
					angle : threat.angle - 180,
					distance : distance,
					threat : threat
				});
			}
		}

		// this.addWall(player, angles);

		var totalDistance = 0;
		var minDistanceAngle = null;
		for (i = 0; i < angles.length; i++) {

			angle = angles[i];

			totalDistance += angle.distance;

			if (minDistanceAngle === null || angle.distance < minDistanceAngle.distance) {
				minDistanceAngle = angle;
			}
		}

		if (angles.length > 0) {

			var totalAngleRange = (360 - (angles.length * 2)) / angles.length;
			var destAngle = angles[0].angle;
			var range;

			for (i = 1; i < angles.length; i++) {
				angle = angles[i];
				angle.shift = 1 - (angle.distance / totalDistance);
				if (angles.length == 1) {
					angle.shift = 0.5;
				}
				angle.shift = Math.max(1, Math.round(angle.shift * (totalAngleRange / 2)));

				range = new Range(destAngle, angle.angle);
				if (range.size() > 180) {
					destAngle -= angle.shift;
				} else {
					destAngle += angle.shift;
				}
				destAngle = Util.mod(destAngle);
			}
			// need the range to be calculated from the min distance threat
			// need distance added

			range = this.getSafeRange(minDistanceAngle.threat.cell, minDistanceAngle.threat.entity,
					minDistanceAngle.threat.dangerZone);

			allRanges.push(new Range(destAngle - range.size() / 2, destAngle + range.size() / 2,
					minDistanceAngle.distance));
		}

		return {
			failed : false,
			ranges : allRanges
		};
	};

	this.combineRanges = function(ranges) {

		var result = [];

		for (var i = 0; i < ranges.length; i++) {
			var range = ranges[i];

			this.addRange(result, range);

			if (result.length == 1) {
				if (result[0].size() >= 360) {
					console.log('bad range');
					return null;
				}
			}
		}

		return result;
	};

	this.avoidThreats2 = function(player, destination, shrinkage, length) {

		var allRanges = [];
		var i;

		// for merge mass
		for (i = 0; i < player.cells.length; i++) {
			var cell = player.cells[i];

			cell.threatened = false;
		}

		this.addWall(player, allRanges);

		player.allThreats.sort(function(a, b) {
			if (b.cell.size < a.cell.size) {
				return -1;
			}

			var diff = Math.max(a.distance - a.dangerZone, 0) - Math.max(b.distance - b.dangerZone, 0);
			if (diff > 0) {
				return 1;
			} else if (diff < 0) {
				return -1;
			}
			return 0;
		});

		for (i = 0; i < player.allThreats.length; i++) {

			var threat = player.allThreats[i];

			/*
			if (threat.distance < threat.dangerZone) {

				var x = 90 / shrinkage; // 180 degress initially, then 90, 45, 22.5
				allRanges.push(new Range(Util.mod(threat.angle + x), Util.mod(threat.angle - x)));
			}
			*/

			if (threat.distance < threat.dangerZone) {
				/*
				var overlap = threat.dangerZone - threat.distance;
				var perc = (threat.cell.size - overlap) / threat.cell.size;
				var x = 90 + 90 * perc;
				if (x < 2) {
					x = 2;
				}
				if (x > 178) {
					x = 178;
				}
				console.log([ overlap, threat.size, threat.cell.size, threat.distance, perc, x ]);
				allRanges.push(new Range(Util.mod(threat.angle + x), Util.mod(threat.angle - x)));
				*/
				allRanges.push(this.getMinimumRange(threat.cell, threat));
			}
		}

		// if the range is 360, choose the range with the smallest distance and invert angle

		return this.combineRanges(allRanges, length || allRanges.length);
	};

	this.combineRanges2 = function(ranges, length) {

		var result = {
			failed : false,
			ranges : [],
			max : 0
		};

		for (result.max = 0; result.max < length; result.max++) {
			var range = ranges[result.max];

			this.addRange(result.ranges, range);

			if (result.ranges.length == 1) {
				if (result.ranges[0].size() >= 360) {
					console.log('bad range');
					result.failed = true;
					result.ranges = null;
					return result;
				}
			}
		}

		return result;
	};

	this.calculateRisk = function(entity) {
		entity.riskFactor = 1;
		if (!entity.isType(Classification.virus)) {

			if (entity.isLargeThreat) {
				entity.riskFactor = 2;
			} else if (entity.isSplitThreat) {
				entity.riskFactor = 4;
			} else {
				entity.riskFactor = 3;
			}
			if (entity.isMovingTowards) {
				entity.riskFactor *= 2;
			}
		}
	};

	this.setVerticalToggle = function(player) {

		var entity, i;
		
		if (!player.canMerge()) {
			this.verticalDistance = true;
			return;
		}
		
		var threatExists;
		
		for (i = 0; i < player.allThreats.length; i++) {
			entity = player.allThreats[i];
			
			if (entity.classification != Classification.virus) {
				threatExists = true;
				break;
			}
		}
		
		if (!threatExists) {
			this.verticalDistance = true;
			return;
		}

		for (i = 0; i < player.allThreats.length; i++) {

			entity = player.allThreats[i];

			if (entity.isSplitThreat) {
				this.verticalDistance = true;
				return;
			}
		}
		this.verticalDistance = false;
	};

	this.setAggressionLevel = function() {

		var keys = Object.keys(this.entities).filter(this.entities.threatFilter, this.entities);
		var i, entity;

		if (keys.length === 0) {
			this.aggressionLevel = 3;
			return;
		}

		for (i = 0; i < keys.length; i++) {

			entity = this.entities[keys[i]];

			if (entity.isMovingTowards) {
				this.aggressionLevel = 1;
				return;
			}
		}

		for (i = 0; i < keys.length; i++) {

			entity = this.entities[keys[i]];
			
			if (entity.distance < 1000) {
				this.aggressionLevel = 1;
				return;
			}
		}

		this.agressionLevel = 2;
	};

	this.determineBestDestination = function(player, destination) {

		player.allThreats = [];

		for (var i = 0; i < player.cells.length; i++) {
			var cell = player.cells[i];

			cell.threats = [];
			cell.threatened = false; // for merge mass
		}

		Object.keys(this.entities).filter(this.entities.threatAndVirusFilter, this.entities).forEach(function(key) {

			var entity = this.entities[key];

			this.calculateThreatWeight(player, entity);

			entity.range = this.get180Range(Util.getAngle(entity, entity.closestCell), entity.distance);

			/*
			if (entity.isType(Classification.threat)) {
				this.drawRange(player.x, player.y, 200, entity.range, 0, Constants.orange);
			}
			*/

			this.calculateRisk(entity);

			if (player.cells.length == 1 && entity.classification == Classification.threat) {
				// this.predictPosition(threat, 200);
				if (entity.distance < entity.size + player.largestCell.size * 0.75 && entity.getVelocity2() > 50) {
					console.log('splitting due to near death');
					player.split(null, 0, 0, destination);
				}
			}
		}, this);

		this.setAggressionLevel();
		this.setVerticalToggle(player);

		var imminentThreatCount = 0;
		var intersectCount = 0;
		var overlappedBy = null;

		player.eachCellThreat(function(cell, threat) {

			if (threat.distance < threat.dangerZone) {
				// only increment if it is a different threat (not the same threat for 2 different cells)
				if (!overlappedBy) {
					overlappedBy = threat;
					imminentThreatCount++;
				} else if (threat.entity != overlappedBy.entity) {
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

		var result = this.avoidThreats(player, destination, 1);

		if (result.failed) {

			player.eachCellThreat(function(cell, threat) {
				threat.dangerZone = threat.minDistance;
			});

			for (i = 2; i < 5; i++) {

				console.log('trying again to determine destination ' + i);
				result = this.avoidThreats(player, destination, i);
				if (!result.failed) {
					break;
				}
				console.log('could not determine destination: ' + i);

			}
			if (result.failed) {
				console.log('last try');
				console.log(result);
				result = this.avoidThreats(player, destination, 4, result.max);
				console.log(result);
			}
		}

		var ranges = result.ranges;

		destination.point.x = player.x;
		destination.point.y = player.y;

		if (ranges) {

			this.drawRanges(player, ranges);
			if (!this.determineFoodDestination(player, destination, ranges)) {
				if (ranges.length > 0) {

					// should get the range with the largest size
					var midPoint = ranges[0].getInverseMidpoint();
					destination.point = this.followAngle(midPoint, player.x, player.y, verticalDistance());

					drawLine(player.x, player.y, destination.point.x, destination.point.y, Constants.red);
				}
			}

		} else {
			drawLine(player.x, player.y, destination.point.x, destination.point.y, Constants.green);
		}
	};

	this.drawRanges = function(player, ranges) {

		for (var i = 0; i < ranges.length; i++) {
			var range = ranges[i];

			this.drawRange(player.x, player.y, player.size + 100, range, i, Constants.red);
		}
	};

	/**
	 * This is the main bot logic. This is called quite often.
	 * @return A 2 dimensional array with coordinates for every cells.  [[x, y], [x, y]]
	 */
	this.mainLoop = function(cells) {

		if (this.noProcessing) {
			return {
				x : 0,
				y : 0,
				split : false,
				shoot : false,
				override : false
			};
		}

		if (!this.initialized) {
			this.initialized = true;
			initializeEntity();
		}

		this.infoStrings = [];

		this.entities = getCells();
		this.player.setCells(cells, this.entities);

		var destination = this.update(cells);

		this.previousUpdated = getLastUpdate();

		if (!isHumanControlled()) {
			this.updateInfo(this.player);

			Object.keys(this.entities).forEach(function(key) {

				var entity = this.entities[key];

				entity.lastX = entity.x;
				entity.lastY = entity.y;
				entity.lastSize = entity.size;

			}, this);

		}

		if (this.player.splitFor) {
			drawCircle(this.player.splitFor.x, this.player.splitFor.y, this.player.splitFor.size + 50, Constants.orange);
		}

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

		/*
		drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX()
				+ (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), Constants.gray);
		drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), getX()
				+ (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), Constants.gray);
		drawLine(getX() - (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX()
				- (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), Constants.gray);
		drawLine(getX() + (1920 / 2) / getZoomlessRatio(), getY() - (1080 / 2) / getZoomlessRatio(), getX()
				+ (1920 / 2) / getZoomlessRatio(), getY() + (1080 / 2) / getZoomlessRatio(), Constants.gray);
		*/

		drawCircle(player.x, player.y, player.largestCell.splitDistance, Constants.pink);

		//loop through everything that is on the screen and
		//separate everything in it's own category.

		this.initializeEntities(player);
		if (!isHumanControlled()) {
			this.determineMerges();
		}

		this.separateListBasedOnFunction(player);
		this.setClosestVirus(player);
		this.displayVirusTargets(player);
		player.mergeMass();

		if (player.action && player.action(destination, this.entities)) {
			return destination;
		}

		if (!isHumanControlled()) {
			if (this.checkViruses(player, destination)) {
				return destination;
			}

			this.determineTeams();
			player.checkIfMerging();
			// this.calculateVirusMass(player);

			this.determineBestDestination(player, destination);
		}

		Object.keys(this.entities).forEach(function(key) {

			var entity = this.entities[key];

			switch (entity.classification) {
			case Classification.player:
				if (entity.fuseTimer) {
					var fuseTime = entity.getFuseTime();
					var y = entity.y + 40 + entity.size / 15;
					drawPoint(entity.x, y, Constants.gray, parseInt(fuseTime / 1000), 24);
				}
				break;
			case Classification.virus:
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

		if (!isHumanControlled()) {

			player.eachCellThreat(function(cell, threat) {

				if (threat.isSplitThreat) {

					var tsize = Math.sqrt(threat.mass / 2 * 100);
					var shadowDistance = Math.min(threat.splitDistance, threat.distance);
					var angle = Util.degreesToRadians(threat.angle);

					var shadowThreat = {
						x : threat.entity.x - Math.cos(angle) * shadowDistance,
						y : threat.entity.y - Math.sin(angle) * shadowDistance,
					};
					// distance = Util.computeDistance(shadowThreat.x, shadowThreat.y, cell.x, cell.y);

					drawCircle(shadowThreat.x, shadowThreat.y, tsize, Constants.gray);

					var shadowLineDistance = Math.min(threat.splitDistance - tsize, threat.distance);
					var shadowThreatLine = {
						x : threat.entity.x - Math.cos(angle) * shadowLineDistance,
						y : threat.entity.y - Math.sin(angle) * shadowLineDistance,
					};

					drawLine(threat.entity.x, threat.entity.y, shadowThreatLine.x, shadowThreatLine.y,
							threat.isMovingTowards ? Constants.red : Constants.gray);
				}
			}, this);

			Object.keys(this.teams).forEach(function(key) {

				var team = this.teams[key];

				drawCircle(team.x, team.y, team.size, Constants.cyan);
			}, this);
		}

		return destination;
	};

	this.updateInfo = function(player) {
		this.infoStrings.push("");
		this.infoStrings.push("Mass      : " + parseInt(player.mass, 10));
		this.infoStrings.push("");
		this.infoStrings.push("Size      : " + parseInt(player.size, 10));
		this.infoStrings.push("Velocity  : " + parseInt(player.smallestCell.velocity, 10));
		this.infoStrings.push("Speed     : " + parseInt(player.cells[0].getSpeed()));
		this.infoStrings.push("Split     : " + parseInt(player.cells[0].splitDistance));
		this.infoStrings.push("Vertical  : " + (this.verticalDistance ? "True" : "False"));
		this.infoStrings.push("Aggression: " + this.aggressionLevel);
		this.infoStrings.push("Zoom      : " + getRatio() + " " + getZoomlessRatio());

		/*
		if (player.cells.length > 1) {
			this.infoStrings.push("Player Min:  " + parseInt(player.smallestCell.size, 10));
			this.infoStrings.push("Player Max:  " + parseInt(player.largestCell.size, 10));
		}
		*/

		//console.log(1 * Math.pow(player.cells[0].mass, -1.0 / 4.5) * 50 / 40);
		if (player.cells.length > 1) {
			this.infoStrings.push("");

			for (var i = 0; i < player.cells.length; i++) {

				var cell = player.cells[i];
				var cellInfo = "Cell " + i + " Mass: " + parseInt(cell.mass, 10);
				if (cell.fuseTimer && i > 0) {
					var fuseTime = (30 + cell.mass * Constants.mergeFactor) * 1000;
					fuseTime = fuseTime - (Date.now() - cell.fuseTimer);

					cellInfo += "   Fuse: " + parseInt(fuseTime / 1000);
				}
				this.infoStrings.push(cellInfo);
			}
		}
		this.infoStrings.push("");
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

		if (!cell.isMoving() && !cell.isVirus() && blob.canEat(cell, Constants.playerRatio)) {
			return true;
		}
		return false;
	};

	// can i split and eat someone
	this.canSplitKill = function(eater, eatee, ratio) {

		if (eater.mass >= 36 && eater.mass > eatee.mass) {
			return (eater.mass / 2) / eatee.mass > ratio;
		}
		return false;
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

	this.drawRange = function(x, y, size, range, index, color) {

		var leftPt = Util.pointFromAngle(x, y, range.left, size - index * 10);
		var rightPt = Util.pointFromAngle(x, y, range.right, size - index * 10);

		drawLine(x, y, leftPt.x, leftPt.y, color);
		drawLine(x, y, rightPt.x, rightPt.y, color);
		drawArc(leftPt.x, leftPt.y, rightPt.x, rightPt.y, x, y, color);

		drawPoint(leftPt.x, leftPt.y, Constants.gray, Math.floor(range.left));
		drawPoint(rightPt.x, rightPt.y, Constants.gray, Math.floor(range.right));
	};

	this.drawAngle = function(cell, angle, distance, color) {
		var line1 = this.followAngle(angle[0], cell.x, cell.y, distance + cell.size);
		var line2 = this.followAngle(Util.mod(angle[0] + angle[1]), cell.x, cell.y, distance + cell.size);

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

		var side = Util.mod(angle - 90);
		if (side < 180) {
			return coords[1];
		} else {
			return coords[0];
		}
	};

	this.addWall = function(player, ranges) {

		var distanceFromWallY = player.size;
		var distanceFromWallX = player.size;

		if (player.x < getMapStartX() + distanceFromWallX) { // LEFT
			this.addRange(ranges, new Range(90, 270), player.x - getMapStartX());
		}
		if (player.y < getMapStartY() + distanceFromWallY) { // TOP
			this.addRange(ranges, new Range(180, 359), player.y - getMapStartY());
		}
		if (player.x > getMapEndX() - distanceFromWallX) { // RIGHT
			this.addRange(ranges, new Range(270, 90), getMapEndX() - player.x);
		}
		if (player.y > getMapEndY() - distanceFromWallY) { // BOTTOM
			this.addRange(ranges, new Range(0, 180), getMapEndY() - player.y);
		}
	};

	this.inSplitRange = function(cluster) {

		var interceptPoint = this.interceptPosition(cluster.cell.closestCell, cluster.cell);

		if (!interceptPoint) {
			return false;
		}
		var range = cluster.closestCell.splitDistance;

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
/*! @asymmetrik/leaflet-d3 - 2.0.3 - Copyright (c) 2007-2017 Asymmetrik Ltd, a Maryland Corporation */
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('d3'), require('d3-hexbin'), require('leaflet')) :
	typeof define === 'function' && define.amd ? define(['exports', 'd3', 'd3-hexbin', 'leaflet'], factory) :
	(factory((global.leafletD3 = global.leafletD3 || {}),global.d3,global.d3.hexbin));
}(this, (function (exports,d3,d3Hexbin) { 'use strict';

/**
 * This is a convoluted way of getting ahold of the hexbin function.
 * - When imported globally, d3 is exposed in the global namespace as 'd3'
 * - When imported using a module system, it's a named import (and can't collide with d3)
 * - When someone isn't importing d3-hexbin, the named import will be undefined
 *
 * As a result, we have to figure out how it's being imported and get the function reference
 * (which is why we have this convoluted nested ternary statement
 */
var d3_hexbin = (null != d3.hexbin)? d3.hexbin : (null != d3Hexbin)? d3Hexbin.hexbin : null;

/**
 * L is defined by the Leaflet library, see git://github.com/Leaflet/Leaflet.git for documentation
 * We extent L.Layer if it exists, L.Class otherwise. This is for backwards-compatibility with
 * Leaflet < 1.x
 */
L.HexbinLayer = (L.Layer ? L.Layer : L.Class).extend({
	includes: [ L.Mixin.Events ],

	/**
	 * Default options
	 */
	options : {
		radius : 12,
		opacity: 0.6,
		duration: 200,

		colorScaleExtent: [ 1, undefined ],
		radiusScaleExtent: [ 1, undefined ],
		colorRange: [ '#f7fbff', '#08306b' ],
		radiusRange: [ 4, 12 ],

		pointerEvents: 'all'
	},


	/**
	 * Standard Leaflet initialize function, accepting an options argument provided by the
	 * user when they create the layer
	 * @param options Options object where the options override the defaults
	 */
	initialize : function(options) {
		L.setOptions(this, options);

		// Set up the various overrideable functions
		this._fn = {
			lng: function(d) { return d[0]; },
			lat: function(d) { return d[1]; },
			colorValue: function(d) { return d.length; },
			radiusValue: function(d) { return Number.MAX_VALUE; },

			fill: function(d) {
				var val = this._fn.colorValue(d);
				return (null != val) ? this._scale.color(val) : 'none';
			}
		};

		// Set up the customizable scale
		this._scale = {
			color: d3.scaleLinear(),
				radius: d3.scaleLinear()
		};

		// Set up the Dispatcher for managing events and callbacks
		this._dispatch = d3.dispatch('mouseover', 'mouseout', 'click');


			// Create the hex layout
		this._hexLayout = d3_hexbin()
			.radius(this.options.radius)
			.x(function(d) { return d.point[0]; })
			.y(function(d) { return d.point[1]; });

		// Initialize the data array to be empty
		this._data = [];

		this._scale.color
			.range(this.options.colorRange)
			.clamp(true);

		this._scale.radius
			.range(this.options.radiusRange)
			.clamp(true);

	},

	/**
	 * Callback made by Leaflet when the layer is added to the map
	 * @param map Reference to the map to which this layer has been added
	 */
	onAdd : function(map) {

		// Store a reference to the map for later use
		this._map = map;

		// Create a container for svg
		this._initContainer();

		// Redraw on moveend
		map.on({ 'moveend': this.redraw }, this);

		// Initial draw
		this.redraw();

	},

	/**
	 * Callback made by Leaflet when the layer is removed from the map
	 * @param map Reference to the map from which this layer is being removed
	 */
	onRemove : function(map) {

		// Destroy the svg container
		this._destroyContainer();

		// Remove events
		map.off({ 'moveend': this.redraw }, this);

		this._container = null;
		this._map = null;

		// Explicitly will leave the data array alone in case the layer will be shown again
		//this._data = [];

	},

	/**
	 * Create the SVG container for the hexbins
	 * @private
	 */
	_initContainer : function() {

		// If the container is null or the overlay pane is empty, create the svg element for drawing
		if (null == this._container) {

			// The svg is in the overlay pane so it's drawn on top of other base layers
			var overlayPane = this._map.getPanes().overlayPane;

			// The leaflet-zoom-hide class hides the svg layer when zooming
			this._container = d3.select(overlayPane).append('svg')
				.attr('class', 'leaflet-layer leaflet-zoom-hide');
		}

	},

	/**
	 * Clean up the svg container
	 * @private
	 */
	_destroyContainer: function() {

		// Remove the svg element
		if (null != this._container) {
			this._container.remove();
		}

	},

	/**
	 * (Re)draws the hexbins data on the container
	 * @private
	 */
	redraw : function() {
		var that = this;

		if (!that._map) {
			return;
		}

		// Generate the mapped version of the data
		var data = that._data.map(function(d) {
			var lng = that._fn.lng(d);
			var lat = that._fn.lat(d);

			var point = that._project([ lng, lat ]);
			return { o: d, point: point };
		});

		// Determine the bounds from the data and scale the overlay
		var margin = 512; // We're adding a large margin to avoid clipping during transitions
		var bounds = this._getBounds(data);
		var width = (bounds.max[0] - bounds.min[0]) + (2 * margin),
			height = (bounds.max[1] - bounds.min[1]) + (2 * margin),
			marginTop = bounds.min[1] - margin,
			marginLeft = bounds.min[0] - margin;


		this._container
			.attr('width', width).attr('height', height)
			.style('margin-left', marginLeft + 'px')
			.style('margin-top', marginTop + 'px');

		// Select the hex group for the current zoom level. This has
		// the effect of recreating the group if the zoom level has changed
		var join = this._container.selectAll('g.hexbin')
			.data([ this._map.getZoom() ], function(d) { return d; });

		// enter
		var enter = join.enter().append('g')
			.attr('class', function(d) { return 'hexbin zoom-' + d; });

		// enter + update
		var enterUpdate = enter.merge(join);
		enterUpdate.attr('transform', 'translate(' + -marginLeft + ',' + -marginTop + ')');

		// exit
		join.exit().remove();

		// add the hexagons to the select
		this._createHexagons(enterUpdate, data);

	},

	_createHexagons : function(g, data) {
		var that = this;

		// Create the bins using the hexbin layout
		var bins = that._hexLayout(data);

		// Derive the extents of the data values for each dimension
		var colorExtent = that._getExtent(bins, that._fn.colorValue, that.options.colorScaleExtent);
		var radiusExtent = that._getExtent(bins, that._fn.radiusValue, that.options.radiusScaleExtent);

		// Match the domain cardinality to that of the color range, to allow for a polylinear scale
		var colorDomain = that._linearlySpace(colorExtent[0], colorExtent[1], that._scale.color.range().length);

		// Set the scale domains
		that._scale.color.domain(colorDomain);
		that._scale.radius.domain(radiusExtent);


		/*
		 * Join
		 *    Join the Hexagons to the data
		 *    Use a deterministic id for tracking bins based on position
		 */
		var join = g.selectAll('path.hexbin-hexagon')
			.data(bins, function(d) { return d.x + ':' + d.y; });


		/*
		 * Update
		 *    Set the fill and opacity on a transition
		 *    opacity is re-applied in case the enter transition was cancelled
		 *    the path is applied as well to resize the bins
		 */
		join.transition().duration(that.options.duration)
			.attr('fill', that._fn.fill.bind(that))
			.attr('fill-opacity', that.options.opacity)
			.attr('stroke-opacity', that.options.opacity)
			.attr('d', function(d) {
				return that._hexLayout.hexagon(that._scale.radius(that._fn.radiusValue.call(that, d)));
			});


		/*
		 * Enter
		 *    Establish the path, size, fill, and the initial opacity
		 *    Transition to the final opacity and size
		 */
		join.enter().append('path').attr('class', 'hexbin-hexagon')
			.style('pointer-events', that.options.pointerEvents)
			.attr('transform', function(d) {
				return 'translate(' + d.x + ',' + d.y + ')';
			})
			.attr('d', function(d) {
				return that._hexLayout.hexagon(0);
			})
			.attr('fill', that._fn.fill.bind(that))
			.attr('fill-opacity', 0.01)
			.attr('stroke-opacity', 0.01)
			.on('mouseover', function(d, i) { that._dispatch.call('mouseover', this, d, i); })
			.on('mouseout', function(d, i) { that._dispatch.call('mouseout', this, d, i); })
			.on('click', function(d, i) { that._dispatch.call('click', this, d, i); })
			.transition().duration(that.options.duration)
				.attr('fill-opacity', that.options.opacity)
				.attr('stroke-opacity', that.options.opacity)
				.attr('d', function(d) {
					return that._hexLayout.hexagon(that._scale.radius(that._fn.radiusValue.call(that, d)));
				});


		// Exit
		join.exit()
			.transition().duration(that.options.duration)
				.attr('fill-opacity', 0.01)
				.attr('stroke-opacity', 0.01)
				.attr('d', function(d) {
					return that._hexLayout.hexagon(0);
				})
				.remove();

	},

	_getExtent: function(bins, valueFn, scaleExtent) {

		// Determine the extent of the values
		var extent$$1 = d3.extent(bins, valueFn.bind(this));

		// If either's null, initialize them to 0
		if (null == extent$$1[0]) extent$$1[0] = 0;
		if (null == extent$$1[1]) extent$$1[1] = 0;

		// Now apply the optional clipping of the extent
		if (null != scaleExtent[0]) extent$$1[0] = scaleExtent[0];
		if (null != scaleExtent[1]) extent$$1[1] = scaleExtent[1];

		return extent$$1;

	},

	_project : function(coord) {
		var point = this._map.latLngToLayerPoint([ coord[1], coord[0] ]);
		return [ point.x, point.y ];
	},

	_getBounds: function(data) {
		if(null == data || data.length < 1) {
			return { min: [ 0, 0 ], max: [ 0, 0 ]};
		}

		// bounds is [[min long, min lat], [max long, max lat]]
		var bounds = [ [ 999, 999 ], [ -999, -999 ] ];

		data.forEach(function(element) {
			var x = element.point[0];
			var y = element.point[1];

			bounds[0][0] = Math.min(bounds[0][0], x);
			bounds[0][1] = Math.min(bounds[0][1], y);
			bounds[1][0] = Math.max(bounds[1][0], x);
			bounds[1][1] = Math.max(bounds[1][1], y);
		});

		return { min: bounds[0], max: bounds[1] };
	},

	_linearlySpace: function(from, to, length) {
		var arr = new Array(length);
		var step = (to - from) / Math.max(length - 1, 1);

		for (var i = 0; i < length; ++i) {
			arr[i] = from + (i * step);
		}

		return arr;
	},


	// ------------------------------------
	// Public API
	// ------------------------------------

	radius: function(v) {
		if (!arguments.length) { return this.options.radius; }

		this.options.radius = v;
		this._hexLayout.radius(v);

		return this;
	},

	opacity: function(v) {
		if (!arguments.length) { return this.options.opacity; }
		this.options.opacity = v;

		return this;
	},

	duration: function(v) {
		if (!arguments.length) { return this.options.duration; }
		this.options.duration = v;

		return this;
	},

	colorScaleExtent: function(v) {
		if (!arguments.length) { return this.options.colorScaleExtent; }
		this.options.colorScaleExtent = v;

		return this;
	},

	radiusScaleExtent: function(v) {
		if (!arguments.length) { return this.options.radiusScaleExtent; }
		this.options.radiusScaleExtent = v;

		return this;
	},

	colorRange: function(v) {
		if (!arguments.length) { return this.options.colorRange; }
		this.options.colorRange = v;
		this._scale.color.range(v);

		return this;
	},

	radiusRange: function(v) {
		if (!arguments.length) { return this.options.radiusRange; }
		this.options.radiusRange = v;
		this._scale.radius.range(v);

		return this;
	},

	colorScale: function(v) {
		if (!arguments.length) { return this._scale.color; }
		this._scale.color = v;

		return this;
	},

	radiusScale: function(v) {
		if (!arguments.length) { return this._scale.radius; }
		this._scale.radius = v;

		return this;
	},

	lng: function(v) {
		if (!arguments.length) { return this._fn.lng; }
		this._fn.lng = v;

		return this;
	},

	lat: function(v) {
		if (!arguments.length) { return this._fn.lat; }
		this._fn.lat = v;

		return this;
	},

	colorValue: function(v) {
		if (!arguments.length) { return this._fn.colorValue; }
		this._fn.colorValue = v;

		return this;
	},

	radiusValue: function(v) {
		if (!arguments.length) { return this._fn.radiusValue; }
		this._fn.radiusValue = v;

		return this;
	},

	fill: function(v) {
		if (!arguments.length) { return this._fn.fill; }
		this._fn.fill = v;

		return this;
	},

	data: function(v) {
		if (!arguments.length) { return this._data; }
		this._data = (null != v) ? v : [];

		this.redraw();

		return this;
	},

	/*
	 * Getter for the event dispatcher
	 */
	dispatch: function() {
		return this._dispatch;
	},


	/*
	 * Returns an array of the points in the path, or nested arrays of points in case of multi-polyline.
	 */
	getLatLngs: function () {
		var that = this;

		// Map the data into an array of latLngs using the configured lat/lng accessors
		return this._data.map(function(d) {
			return L.latLng(that.options.lat(d), that.options.lng(d));
		});
	},

	/*
	 * Get path geometry as GeoJSON
	 */
	toGeoJSON: function () {
		return L.GeoJSON.getFeature(this, {
			type: 'LineString',
			coordinates: L.GeoJSON.latLngsToCoords(this.getLatLngs(), 0)
		});
	}

});

L.hexbinLayer = function(options) {
	return new L.HexbinLayer(options);
};

/**
 * L is defined by the Leaflet library, see git://github.com/Leaflet/Leaflet.git for documentation
 * We extent L.Layer if it exists, L.Class otherwise. This is for backwards-compatibility with
 * Leaflet < 1.x
 */
L.PingLayer = (L.Layer ? L.Layer : L.Class).extend({
	includes: [ L.Mixin.Events ],

	/*
	 * Default options
	 */
	options : {
		duration: 800,
		fps: 32,
		opacityRange: [ 1, 0 ],
		radiusRange: [ 3, 15 ]
	},


	// Initialization of the plugin
	initialize : function(options) {
		L.setOptions(this, options);

		this._fn = {
			lng: function(d) { return d[0]; },
			lat: function(d) { return d[1]; },
			radiusScaleFactor: function(d) { return 1; }
		};

		this._scale = {
			radius: d3.scalePow().exponent(0.35),
				opacity: d3.scaleLinear()
		};

		this._lastUpdate = Date.now();
		this._fps = 0;
		this._mapBounds = undefined;

		this._scale.radius
			.domain([ 0, this.options.duration ])
			.range(this.options.radiusRange)
			.clamp(true);
		this._scale.opacity
			.domain([ 0, this.options.duration ])
			.range(this.options.opacityRange)
			.clamp(true);
	},

	// Called when the plugin layer is added to the map
	onAdd : function(map) {

		// Store a reference to the map for later use
		this._map = map;

		// Init the state of the simulation
		this._running = false;

		// Create a container for svg
		this._initContainer();
		this._updateContainer();

		// Set up events
		map.on({'move': this._move}, this);

	},

	// Called when the plugin layer is removed from the map
	onRemove : function(map) {

		// Destroy the svg container
		this._destroyContainer();

		// Remove events
		map.off({'move': this._move}, this);

		this._container = null;
		this._map = null;
		this._data = null;
	},


	/*
	 * Private Methods
	 */

	// Initialize the Container - creates the svg pane
	_initContainer : function() {

		// If the container is null or the overlay pane is empty, create the svg element for drawing
		if (null == this._container) {

			// The svg is in the overlay pane so it's drawn on top of other base layers
			var overlayPane = this._map.getPanes().overlayPane;

			// The leaflet-zoom-hide class hides the svg layer when zooming
			this._container = d3.select(overlayPane).append('svg')
				.attr('class', 'leaflet-layer leaflet-zoom-hide');
		}

	},

	// Update the container - Updates the dimensions of the svg pane
	_updateContainer : function() {

		var bounds = this._getMapBounds();
		this._mapBounds = bounds;

		this._container
			.attr('width', bounds.width).attr('height', bounds.height)
			.style('margin-left', bounds.left + 'px')
			.style('margin-top', bounds.top + 'px');

		this._update(true);

	},

	// Cleanup the svg pane
	_destroyContainer: function() {

		// Remove the svg element
		if(null != this._container) {
			this._container.remove();
		}

	},


	// Calculate the current map bounds
	_getMapBounds: function() {
		var latLongBounds = this._map.getBounds();
		var ne = this._map.latLngToLayerPoint(latLongBounds.getNorthEast());
		var sw = this._map.latLngToLayerPoint(latLongBounds.getSouthWest());

		var bounds = {
			width: ne.x - sw.x,
			height: sw.y - ne.y,
			left: sw.x,
			top: ne.y
		};

		return bounds;
	},

	// Calculate the circle coordinates for the provided data
	_getCircleCoords: function(geo$$1) {
		var point = this._map.latLngToLayerPoint(geo$$1);
		return { x: point.x - this._mapBounds.left, y: point.y - this._mapBounds.top };
	},

	// Update the map based on zoom/pan/move
	_move: function() {
		this._updateContainer();
	},

	// Add a ping to the map
	_add : function(data, cssClass) {
		// Lazy init the data array
		if (null == this._data) this._data = [];

		// Derive the spatial data
		var geo$$1 = [ this._fn.lat(data), this._fn.lng(data) ];
		var coords = this._getCircleCoords(geo$$1);

		// Add the data to the list of pings
		var circle = {
			data: data,
			geo: geo$$1,
			ts: Date.now(),
			nts: 0
		};
		circle.c = this._container.append('circle')
			.attr('class', (null != cssClass)? 'ping ' + cssClass : 'ping')
			.attr('cx', coords.x)
			.attr('cy', coords.y)
			.attr('r', this._fn.radiusScaleFactor.call(this, data) * this._scale.radius.range()[0]);

		// Push new circles
		this._data.push(circle);
	},

	// Main update loop
	_update : function(immediate) {
		var nowTs = Date.now();
		if (null == this._data) this._data = [];

		var maxIndex = -1;

		// Update everything
		for (var i=0; i < this._data.length; i++) {

			var d = this._data[i];
			var age = nowTs - d.ts;

			if (this.options.duration < age) {

				// If the blip is beyond it's life, remove it from the dom and track the lowest index to remove
				d.c.remove();
				maxIndex = i;

			}
			else {

				// If the blip is still alive, process it
				if (immediate || d.nts < nowTs) {

					var coords = this._getCircleCoords(d.geo);

					d.c.attr('cx', coords.x)
					   .attr('cy', coords.y)
					   .attr('r', this._fn.radiusScaleFactor.call(this, d.data) * this._scale.radius(age))
					   .attr('fill-opacity', this._scale.opacity(age))
					   .attr('stroke-opacity', this._scale.opacity(age));
					d.nts = Math.round(nowTs + 1000/this.options.fps);

				}
			}
		}

		// Delete all the aged off data at once
		if (maxIndex > -1) {
			this._data.splice(0, maxIndex + 1);
		}

		// The return function dictates whether the timer loop will continue
		this._running = (this._data.length > 0);

		if (this._running) {
			this._fps = 1000/(nowTs - this._lastUpdate);
			this._lastUpdate = nowTs;
		}

		return !this._running;
	},

	// Expire old pings
	_expire : function() {
		var maxIndex = -1;
		var nowTs = Date.now();

		// Search from the front of the array
		for (var i=0; i < this._data.length; i++) {
			var d = this._data[i];
			var age = nowTs - d.ts;

			if(this.options.duration < age) {
				// If the blip is beyond it's life, remove it from the dom and track the lowest index to remove
				d.c.remove();
				maxIndex = i;
			}
			else {
				break;
			}
		}

		// Delete all the aged off data at once
		if (maxIndex > -1) {
			this._data.splice(0, maxIndex + 1);
		}
	},

	/*
	 * Public Methods
	 */

	duration: function(v) {
		if (!arguments.length) { return this.options.duration; }
		this.options.duration = v;

		return this;
	},

	fps: function(v) {
		if (!arguments.length) { return this.options.fps; }
		this.options.fps = v;

		return this;
	},

	lng: function(v) {
		if (!arguments.length) { return this._fn.lng; }
		this._fn.lng = v;

		return this;
	},

	lat: function(v) {
		if (!arguments.length) { return this._fn.lat; }
		this._fn.lat = v;

		return this;
	},

	radiusRange: function(v) {
		if (!arguments.length) { return this.options.radiusRange; }
		this.options.radiusRange = v;
		this._scale.radius().range(v);

		return this;
	},

	opacityRange: function(v) {
		if (!arguments.length) { return this.options.opacityRange; }
		this.options.opacityRange = v;
		this._scale.opacity().range(v);

		return this;
	},

	radiusScale: function(v) {
		if (!arguments.length) { return this._scale.radius; }
		this._scale.radius = v;

		return this;
	},

	opacityScale: function(v) {
		if (!arguments.length) { return this._scale.opacity; }
		this._scale.opacity = v;

		return this;
	},

	radiusScaleFactor: function(v) {
		if (!arguments.length) { return this._fn.radiusScaleFactor; }
		this._fn.radiusScaleFactor = v;

		return this;
	},

	/*
	 * Method by which to "add" pings
	 */
	ping : function(data, cssClass) {
		this._add(data, cssClass);
		this._expire();

		// Start timer if not active
		if (!this._running && this._data.length > 0) {
			this._running = true;
			this._lastUpdate = Date.now();

			var that = this;
			d3.timer(function() { that._update.call(that, false); });
		}

		return this;
	},

	getActualFps : function() {
		return this._fps;
	},

	data : function() {
		return this._data;
	},

});

L.pingLayer = function(options) {
	return new L.PingLayer(options);
};

/**
 * Initial work by Teralytics AG (Copyright 2015)
 * @author Kirill Zhuravlev <kirill.zhuravlev@teralytics.ch>
 *
 */
/**
 * L is defined by the Leaflet library, see git://github.com/Leaflet/Leaflet.git for documentation
 * We extent L.Layer if it exists, L.Class otherwise. This is for backwards-compatibility with
 * Leaflet < 1.x
 */

// Tiny stylesheet bundled here instead of a separate file
if (L.version >= "1.0") {
	d3.select("head")
		.append("style").attr("type", "text/css")
		.text("g.d3-overlay *{pointer-events:visiblePainted;}");
}

// Class definition
L.D3SvgLayer = (L.Layer ? L.Layer : L.Class).extend({
	includes: (L.version < "1.0" ? L.Mixin.Events : []),

	_undef: function (a) {
		return typeof a === "undefined"
	},

	_options: function (options) {
		if (this._undef(options)) {
			return this.options;
		}
		options.zoomHide = this._undef(options.zoomHide) ? false : options.zoomHide;
		options.zoomDraw = this._undef(options.zoomDraw) ? true : options.zoomDraw;

		return this.options = options;
	},

	_disableLeafletRounding: function () {
		this._leaflet_round = L.Point.prototype._round;
		L.Point.prototype._round = function () {
			return this;
		};
	},

	_enableLeafletRounding: function () {
		L.Point.prototype._round = this._leaflet_round;
	},

	draw: function () {
		this._disableLeafletRounding();
		this._drawCallback(this.selection, this.projection, this.map.getZoom());
		this._enableLeafletRounding();
	},

	initialize: function (drawCallback, options) { // (Function(selection, projection)), (Object)options
		this._options(options || {});
		this._drawCallback = drawCallback;
	},

	// Handler for "viewreset"-like events, updates scale and shift after the animation
	_zoomChange: function (evt) {
		this._disableLeafletRounding();
		var newZoom = this._undef(evt.zoom) ? this.map._zoom : evt.zoom; // "viewreset" event in Leaflet has not zoom/center parameters like zoomanim
		this._zoomDiff = newZoom - this._zoom;
		this._scale = Math.pow(2, this._zoomDiff);
		this.projection.scale = this._scale;
		this._shift = this.map.latLngToLayerPoint(this._wgsOrigin)
			._subtract(this._wgsInitialShift.multiplyBy(this._scale));

		var shift = [ "translate(", this._shift.x, ",", this._shift.y, ") " ];
		var scale = [ "scale(", this._scale, ",", this._scale, ") " ];
		this._rootGroup.attr("transform", shift.concat(scale).join(""));

		if (this.options.zoomDraw) {
			this.draw();
		}
		this._enableLeafletRounding();
	},

	onAdd: function (map) {
		this.map = map;
		var _layer = this;

		// SVG element
		if (L.version < "1.0") {
			map._initPathRoot();
			this._svg = d3.select(map._panes.overlayPane)
				.select("svg");
			this._rootGroup = this._svg.append("g");
		}
		else {
			this._svg = L.svg();
			map.addLayer(this._svg);
			this._rootGroup = d3.select(this._svg._rootGroup).classed("d3-overlay", true);
		}
		this._rootGroup.classed("leaflet-zoom-hide", this.options.zoomHide);
		this.selection = this._rootGroup;

		// Init shift/scale invariance helper values
		this.initHelperValues();

		// Create projection object
		this.projection = {
			latLngToLayerPoint: function (latLng, zoom) {
				zoom = _layer._undef(zoom) ? _layer._zoom : zoom;
				var projectedPoint = _layer.map.project(L.latLng(latLng), zoom)._round();
				return projectedPoint._subtract(_layer._pixelOrigin);
			},
			layerPointToLatLng: function (point, zoom) {
				zoom = _layer._undef(zoom) ? _layer._zoom : zoom;
				var projectedPoint = L.point(point).add(_layer._pixelOrigin);
				return _layer.map.unproject(projectedPoint, zoom);
			},
			unitsPerMeter: 256 * Math.pow(2, _layer._zoom) / 40075017,
			map: _layer.map,
			layer: _layer,
			scale: 1
		};
		this.projection._projectPoint = function (x, y) {
			var point = _layer.projection.latLngToLayerPoint(new L.LatLng(y, x));
			this.stream.point(point.x, point.y);
		};
		if (d3.geo) {
			//d3 v3
			this.projection.pathFromGeojson = d3.geo.path().projection(d3.geo.transform({point: this.projection._projectPoint}));
		}
		else {
			//d3 v4
			this.projection.pathFromGeojson = d3.geoPath().projection(d3.geoTransform({point: this.projection._projectPoint}));

		}
		// Compatibility with v.1
		this.projection.latLngToLayerFloatPoint = this.projection.latLngToLayerPoint;
		this.projection.getZoom = this.map.getZoom.bind(this.map);
		this.projection.getBounds = this.map.getBounds.bind(this.map);
		this.selection = this._rootGroup;

		if (L.version < "1.0") map.on("viewreset", this._zoomChange, this);
		// Initial draw
		this.draw();
	},

	// Leaflet 1.0
	getEvents: function () {
		return {zoomend: this._zoomChange};
	},

	onRemove: function (map) {
		if (L.version < "1.0") {
			map.off("viewreset", this._zoomChange, this);
			this._rootGroup.remove();
		}
		else {
			this._svg.remove();
		}
	},

	addTo: function (map) {
		map.addLayer(this);
		return this;
	},
	initHelperValues: function () {
		// Init shift/scale invariance helper values
		this._pixelOrigin = this.map.getPixelOrigin();
		this._wgsOrigin = L.latLng([ 0, 0 ]);
		this._wgsInitialShift = this.map.latLngToLayerPoint(this._wgsOrigin);
		this._zoom = this.map.getZoom();
		this._shift = L.point(0, 0);
		this._scale = 1;
	}

});

L.D3SvgLayer.version = "3.0";

// Factory method
L.d3SvgLayer = function (drawCallback, options) {
	return new L.D3SvgLayer(drawCallback, options);
};

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=leaflet-d3.js.map

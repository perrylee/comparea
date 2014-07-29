// See http://stackoverflow.com/questions/14167863/how-can-i-bring-a-circle-to-the-front-with-d3
d3.selection.prototype.moveToFront = function() {
  return this.each(function(){
    this.parentNode.appendChild(this);
  });
};

var width = document.getElementById('svg-container').offsetWidth,
    height = document.getElementById('svg-container').offsetHeight;

var svg = d3.select("#svg-container").append("svg")
    .attr("width", width)
    .attr("height", height);
svg.append('g')
    .attr('class', 'container');

// Determine a scaling factor which will make both shapes fit on screen.
// This uses the initial scale of 1000 as a guess, then adjusts to fit.
function setScalingFactor(features, paths) {
  var bounds = features.map(function(d, i) { return paths[i].bounds(d); });
  var curWidth = 0, curHeight = 0;
  bounds.forEach(function(b) {
    curWidth += (b[1][0] - b[0][0])
    curHeight = Math.max(curHeight, b[1][1] - b[0][1]);
  });

  var horizScale = curWidth / (0.7 * width);
  var vertScale = curHeight / (0.7 * height);

  var scaleAdjustment = 1.0 / Math.max(horizScale, vertScale);
  paths.forEach(function(path) {
    var proj = path.projection();
    proj.scale(scaleAdjustment * proj.scale());
  });
}

function projectionForCountry(feature) {
  var centroid = d3.geo.centroid(feature);
  var lon = centroid[0], lat = centroid[1];
  var proj = d3.geo.albers()
    .center([0, 0])
    .rotate([-lon, -lat])
    .parallels([0, 60])
    .scale(1000)
    .translate([0,0]);
  return proj;
}

function transformForDrag(d) {
  return 'translate(' + [d.dx,d.dy] + ')';
}

function transformStatic(d) {
  var xy = [d.static_dx, d.static_dy];
  return "translate(" + xy + ")";
}

var drag = d3.behavior.drag()
  .on('drag', function(d, i) {
      d.dx += d3.event.dx;
      d.dy += d3.event.dy;
      d3.select(this)
        .attr('transform', transformForDrag);
  })
  .on('dragstart', function(d, i) {
    // TODO(danvk): look into selection.order() or selection.sort()
    d3.select(this.parentNode).moveToFront();
  });

var zoom = d3.behavior.zoom().on('zoom', function() {
  var sx = zoom.scale(), sy = sx, cx = width/2, cy = height/2;

  // See http://stackoverflow.com/questions/6711610/how-to-set-transform-origin-in-svg
  var matrix = [sx, 0, 0, sy, cx-sx*cx, cy-sy*cy];
  
  d3.select('.container').attr('transform', 'matrix(' + matrix + ')')
});

var geojson_features;

function setDisplayForFeatures(features) {
  if (features.length != 2) throw "Only two shapes supported (for now!)";
  if (features[0] == null || features[1] == null) return;

  var paths = features.map(function(feature) {
    var proj = projectionForCountry(feature);
    return d3.geo.path().projection(proj);
  });
  setScalingFactor(features, paths);

  var bounds = features.map(function(d, i) {
    return paths[i].bounds(d);
  });
  var offsets = bounds.map(function(b) {
    var tl = b[0], br = b[1];
    var offX = tl[0] + br[0], offY = tl[1] + br[1];
    return [offX, offY];
  });
  var spans = bounds.map(function(b) {
    // we'd like the features to be centered around their centroid,
    // not the center of their bounding box. This produces unnecessarily
    // large bounding circles, but tends to look better.
    // Additionally, to get a true bounding circle, we'd need to go out to
    // the farthest corner, not the farthest side.
    var tl = b[0], br = b[1];
    var offX = Math.abs(tl[0] + br[0])/2, offY = Math.abs(tl[1] + br[1])/2;
    offX = 0, offY = 0;
    return Math.max(br[0] - tl[0] + 2*offX, br[1] - tl[1] + 2*offY);
  });

  var classes = {
    children: [
      {idx: 0, value: spans[0]},
      {idx: 1, value: spans[1]}
    ]
  };
  var pack = d3.layout.pack()
    .sort(null)
    .size([width, height])
    .radius(function(v) {
      return v/2;
    })
    .padding(1.5);
  var layout = pack.nodes(classes)
    .filter(function(d) { return !d.children; });

  // TODO(danvk): be more D3-y about this.
  // TODO(danvk): also use d3.layout.pack to set the scale
  features.forEach(function(d, i) {
    d.dx = 0; d.dy = 0;  // initial drag offsets
    d.static_dx = layout[i].x;
    d.static_dy = layout[i].y;
  });

  var dataEls = svg.select('.container').selectAll('.force')
    .data(features, function(f) { return f.id; });

  // enter
  var draggableG = dataEls.enter().append('g')
    .attr('class', function(d, i) { return 'force force' + i; })
    .attr('transform', transformStatic)
      .append('g')
      .attr('class', 'draggable');

   draggableG.append('path')
      .attr('class', function(d, i) { return 'shape shape' + i; })
      .attr('d', function(d, i) { return paths[i](d); });
      
   // ... for layout debugging
   draggableG.append('circle')
      .attr('cx', function(d, i) { return offsets[i][0] })
      .attr('cy', function(d, i) { return offsets[i][1] })
      .attr('r', function(d, i) { return layout[i].r; });

  // update
  dataEls.select('.shape')
      .attr('d', function(d, i) { return paths[i](d); });

  // exit
  dataEls.exit().remove();

  svg.selectAll('.draggable').attr('transform', transformForDrag).call(drag);
  svg.call(zoom);
}


/**
 * Places the centroids of the features along the main (TL to BR) diagonal
 * of the svg area and adjusts the scale so that the features fit snugly.
 *
 * @param {{width:number, height:number}} svgArea
 * @param {Array.<Array.<Array.<number>>>} extents List of [[t,l], [b,r]] pairs.
 * @return {{offsets: Array.<{x:number,y:number}>, scaleMult:number}} Computed
 *      offsets for each shape and a multiplier to apply to the scales.
 */
function calculatePositionsAndScale(svgArea, extents) {
  // bounding boxes for the features under the current projections
  var bounds = extents.map(function(b, i) {
    return {
      width: b[1][0] - b[0][0],
      height: b[1][1] - b[0][1]
    }
  });

  var DIR_X = 0, DIR_Y = 1; 

  // This defines a line mapping a param, t \in [0, 1], to the main diagonal.
  var svgScaleX = d3.scale.linear().domain([0,1]).range([0, svgArea.width]),
      svgScaleY = d3.scale.linear().domain([0,1]).range([0, svgArea.height]);

  // start with a guess for placement -- we'll adjust momentarily.
  var centroidsT = [0.25, 0.75];

  // compute the gap (or overlap) between the two features along the main
  // diagonal. We could be limited by either dimension, so we compute both.
  var yGapT = svgScaleY.invert(
          (svgScaleY(centroidsT[1]) - bounds[1].height / 2) -
          (svgScaleY(centroidsT[0]) + bounds[0].height / 2)),
      xGapT = svgScaleX.invert(
          (svgScaleX(centroidsT[1]) - bounds[1].width / 2) -
          (svgScaleX(centroidsT[0]) + bounds[0].width / 2)),
      dir = xGapT < yGapT ? DIR_X : DIR_Y,
      tGap = Math.min(xGapT, yGapT);

  centroidsT[0] += tGap / 2;
  centroidsT[1] -= tGap / 2;

  var offsets = [
      {x: svgScaleX(centroidsT[0]), y: svgScaleY(centroidsT[0])},
      {x: svgScaleX(centroidsT[1]), y: svgScaleY(centroidsT[1])} ];

  // Now that we know how the features will stack up, we can rescale the UI.
  var xSpan, ySpan;
  if (dir == DIR_X) {
    // feature will line up left/right
    xSpan = bounds[0].width + bounds[1].width;
    ySpan = (offsets[1].y + bounds[1].height / 2) -
        (offsets[0].y - bounds[0].height / 2);
  } else {
    // features will line up top/bottom
    ySpan = bounds[0].height + bounds[1].height;
    xSpan = (offsets[1].x + bounds[1].width / 2) -
        (offsets[0].x - bounds[0].width / 2);
  }
  var xScale = svgArea.width / xSpan,
      yScale = svgArea.height / ySpan,
      scaleMult = Math.min(xScale, yScale);

  // The scale is nailed down. Now we have to reposition the features one
  // more time.
  bounds.forEach(function(b) { b.width *= scaleMult; b.height *= scaleMult; });

  yGapT = svgScaleY.invert(
      (svgScaleY(centroidsT[1]) - bounds[1].height / 2) -
      (svgScaleY(centroidsT[0]) + bounds[0].height / 2)),
  xGapT = svgScaleX.invert(
      (svgScaleX(centroidsT[1]) - bounds[1].width / 2) -
      (svgScaleX(centroidsT[0]) + bounds[0].width / 2)),
  dir = xGapT < yGapT ? DIR_X : DIR_Y,
  tGap = Math.min(xGapT, yGapT);

  centroidsT[0] += tGap / 2;
  centroidsT[1] -= tGap / 2;

  offsets = [
      {x: svgScaleX(centroidsT[0]), y: svgScaleY(centroidsT[0])},
      {x: svgScaleX(centroidsT[1]), y: svgScaleY(centroidsT[1])} ];

  return {
    offsets: offsets,
    scaleMult: scaleMult
  };
}


function featureForId(id) {
  for (var i = 0; i < geojson_features.length; i++) {
    var feature = geojson_features[i];
    if (feature.id == id) return feature;
  }
  return null;
}

function addChooserListeners() {
  $('select.choose').on('change', function(e) {
    var id = $(this).val();
    var ids = [$('#choose0').val(), $('#choose1').val()];
    var changedIdx = $('select.choose').index(this);
    updateEl(changedIdx, ids[changedIdx]);
    history.pushState(null, '', '/' + ids[0] + '+' + ids[1]);
  });
}

function updateEl(changedIdx, newId) {
  $.get('/shape/' + newId)
    .success(function(data) {
      geojson_features[changedIdx] = data.feature;
      $('#side-panel' + changedIdx + ' .feature-panel').html(data.panel);
      setDisplayForFeatures(geojson_features);
    })
    .fail(function(e) {
      console.log(e);
    });
}

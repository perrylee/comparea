// Converts [[t,l], [b,r]] array to {width, height} array.
function boundsToSpans(bounds) {
  return bounds.map(function(b, i) {
    return {
      left: b[0][0],
      right: b[1][0],
      top: b[0][1],
      bottom: b[1][1],
      width: b[1][0] - b[0][0],
      height: b[1][1] - b[0][1],
      centerX: (b[1][0] + b[0][0])/2,
      centerY: (b[1][1] + b[0][1])/2
    }
  });
}


/**
 * Places the centroids of the features along the main (TL to BR) diagonal
 * of the svg area and adjusts the scale so that the features fit snugly.
 *
 * @param {{width:number, height:number}} svgArea
 * @param bounds
 * @return {{offsets: Array.<{x:number,y:number}>, scaleMult:number}} Computed
 *      offsets for each shape and a multiplier to apply to the scales.
 */
function diagonalPacker(svgArea, bounds) {
  // bounding boxes for the features under the current projections
  var spans = boundsToSpans(bounds);

  var DIR_X = 0, DIR_Y = 1; 

  // This defines a line mapping a param, t \in [0, 1], to the main diagonal.
  var svgScaleX = d3.scale.linear().domain([0,1]).range([0, svgArea.width]),
      svgScaleY = d3.scale.linear().domain([0,1]).range([0, svgArea.height]);

  // start with a guess for placement -- we'll adjust momentarily.
  var centroidsT = [0.25, 0.75];

  // compute the gap (or overlap) between the two features along the main
  // diagonal. We could be limited by either dimension, so we compute both.
  var yGapT = svgScaleY.invert(
          (svgScaleY(centroidsT[1]) - spans[1].height / 2 + spans[1].centerY) -
          (svgScaleY(centroidsT[0]) + spans[0].height / 2 + spans[0].centerY)),
      xGapT = svgScaleX.invert(
          (svgScaleX(centroidsT[1]) - spans[1].width / 2 + spans[1].centerX) -
          (svgScaleX(centroidsT[0]) + spans[0].width / 2 + spans[0].centerX)),
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
    xSpan = spans[0].width + spans[1].width;
    ySpan = (offsets[1].y + spans[1].height / 2 + spans[1].centerY) -
        (offsets[0].y - spans[0].height / 2 + spans[0].centerY);
  } else {
    // features will line up top/bottom
    ySpan = spans[0].height + spans[1].height;
    xSpan = (offsets[1].x + spans[1].width / 2 + spans[1].centerX) -
        (offsets[0].x - spans[0].width / 2 + spans[0].centerX);
  }
  var xScale = svgArea.width / xSpan,
      yScale = svgArea.height / ySpan,
      scaleMult = Math.min(xScale, yScale);

  // The scale is nailed down. Now we have to reposition the features one
  // more time.
  spans.forEach(function(b) { b.width *= scaleMult; b.height *= scaleMult; });

  yGapT = svgScaleY.invert(
      (svgScaleY(centroidsT[1]) - spans[1].height / 2 + spans[1].centerY) -
      (svgScaleY(centroidsT[0]) + spans[0].height / 2 + spans[0].centerY)),
  xGapT = svgScaleX.invert(
      (svgScaleX(centroidsT[1]) - spans[1].width / 2 + spans[1].centerX) -
      (svgScaleX(centroidsT[0]) + spans[0].width / 2 + spans[0].centerX)),
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


/**
 * Put the two shapes right on top of one another, expanded/shrunk to fit.
 */
function overlappingPacker(svgArea, bounds) {
  var spans = boundsToSpans(bounds);

  // The two features both have their centroids at (0, 0)
  // We just have to figure out the limits of the combined bbox and adjust.
  var cs = {
    left: Math.min(spans[0].left, spans[1].left),
    right: Math.max(spans[0].right, spans[1].right),
    top: Math.min(spans[0].top, spans[1].top),
    bottom: Math.max(spans[0].bottom, spans[1].bottom)
  };
  var cx = svgArea.width / 2, cy = svgArea.height / 2;

  var scaleMults = [
    /* left */  cx / (-cs.left),
    /* right */ cx / (cs.right),
    /* top */   cy / (-cs.top),
    /* bot. */  cy / (cs.bottom)
  ];
  var scaleMult = Math.min.apply(null, scaleMults);

  return {
    offsets: [{x: cx, y: cy}, {x: cx, y: cy}],
    scaleMult: scaleMult
  }
}

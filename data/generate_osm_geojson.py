#!/usr/bin/env python
'''Generates a GeoJSON file containing all the OSM features.

Input to this script is the "pass.tsv" file generated by osm_filter.py,
which looks like:

    osm_type<tab>osm_id<tab>wikipedia article<tab>name<tab>...
'''

import csv
import fileinput
import os
import json
import sys

from data import osm_filter
from data import fetch_metadata
from data import freebase
from data import geojson_util
from data import only_polygons
from data import osm
from data import osm_filter


def apply_monkey_patches(d):
    # Most people don't care about the Farralons, and they mess up the view.
    if d['id'] == 'relation111968':
        new_sf = geojson_util.subset_feature(d, [-122.547892, 0], [-90, 37.839085])
        # is there a more canonical way to do this in Python?
        for k in d.keys(): d[k] = new_sf[k]


def main(args):
    osm_fetcher = osm.OSM()
    fb = freebase.Freebase()
    features_out = []
    for line in fileinput.input():
        osm_type, osm_id, wiki_title, name = line.strip().split('\t')[:4]
        if wiki_title.startswith("en:"):
            wiki_title = wiki_title[3:]

        # GeoJSON data.
        path = os.path.join(osm_fetcher.cache_dir,
                '%s%s.xml.json' % (osm_type, osm_id))
        try:
            d = json.load(file(path))
        except (ValueError, IOError):
            continue

        props = osm_filter.get_feature_props(d, osm_type, osm_id)
        if not props:
            continue
        freebase_data = fb._get_from_cache(wiki_title)
        assert(freebase_data)

        freebase_extract = fetch_metadata.extract_freebase_metadata(
                '', wiki_title, freebase_data)

        #land_json = path.replace('.xml.json', '.xml.land.simple.json')
        land_json = path.replace('.xml.json', '.xml.land.json')
        if os.path.exists(land_json):
            try:
                d = json.load(file(land_json))
            except (ValueError, IOError):
                continue
        else:
            sys.stderr.write('Could not find %s\n' % land_json)


        # TODO: assign id, override properties.
        d['id'] = '%s%s' % (osm_type, osm_id)  # do better!
        props = {
                'population': 0,
                'population_date': '',
                'population_source': '',
                'population_source_url': '',
                }
        props.update(fetch_metadata.extract_freebase_metadata(
            '', wiki_title, freebase_data))
        if 'area_km2' in props: del props['area_km2']
        props.update({
            'description': 'A nice place!',
            'name': wiki_title,
        })

        only_polygons.remove_non_polygons(d)
        geojson_util.make_polygons_clockwise(d)

        apply_monkey_patches(d)
        area_km2 = geojson_util.get_area_of_feature(d) / 1e6
        if area_km2 == 0:
            sys.stderr.write('Discarding %s (no area)\n' % wiki_title)
            continue
        c_lon, c_lat = geojson_util.centroid_of_feature(d)
        props.update({
            'area_km2': area_km2,
            'area_km2_source': 'calculated',
            'centroid_lon': c_lon,
            'centroid_lat': c_lat
        })
        d['properties'] = props

        features_out.append(d)


    geojson_out = {
        'type': 'FeatureCollection',
        'features': features_out
    }
    print json.dumps(geojson_out, indent=2)


if __name__ == '__main__':
    main(sys.argv)

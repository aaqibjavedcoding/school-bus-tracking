/** KidBus daytime cartography for OpenMapTiles vector tiles. */
export const KIDBUS_DAY_STYLE = {
  version: 8, name: 'kidbus-day',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sprite: '/map-sprites/kidbus',
  layers: [
    { id:'background', type:'background', paint:{'background-color':'#f8f9fa'} },
    { id:'water', type:'fill', source:'openmaptiles', 'source-layer':'water', paint:{'fill-color':'#aadaff'} },
    { id:'waterway', type:'line', source:'openmaptiles', 'source-layer':'waterway', paint:{'line-color':'#aadaff','line-width':{'stops':[[10,1],[16,3]]}} },
    { id:'landcover', type:'fill', source:'openmaptiles', 'source-layer':'landcover', paint:{'fill-color':['match',['get','class'],['park','grass','#c8e6c9'],['wood','#b7e1a1'],'#f8f9fa']} },
    { id:'landuse', type:'fill', source:'openmaptiles', 'source-layer':'landuse', paint:{'fill-color':['match',['get','class'],['park','cemetery'],'#c8e6c9','#f8f9fa'],'fill-opacity':0.7} },
    { id:'building', type:'fill', source:'openmaptiles', 'source-layer':'building', paint:{'fill-color':'#e8eaed','fill-outline-color':'#dadce0'} },
    { id:'road-casings', type:'line', source:'openmaptiles', 'source-layer':'transportation', paint:{'line-color':'#dadce0','line-width':['interpolate',['linear'],['zoom'],8,1,14,3,18,10]} },
    { id:'road-fills', type:'line', source:'openmaptiles', 'source-layer':'transportation', paint:{'line-color':['match',['get','class'],['motorway','trunk'],'#fdd663','#ffffff'],'line-width':['interpolate',['linear'],['zoom'],8,0.5,14,2,18,8]} },
    { id:'rail', type:'line', source:'openmaptiles', 'source-layer':'transportation', filter:['==',['get','class'],'rail'], paint:{'line-color':'#d6d6d6','line-dasharray':[2,2],'line-width':2} },
    { id:'transportation_name', type:'symbol', source:'openmaptiles', 'source-layer':'transportation_name', layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':12}, paint:{'text-color':'#5f6368','text-halo-color':'#ffffff','text-halo-width':2} },
    { id:'place', type:'symbol', source:'openmaptiles', 'source-layer':'place', layout:{'text-field':['get','name'],'text-font':['Noto Sans Bold'],'text-size':['interpolate',['linear'],['zoom'],5,12,12,16]}, paint:{'text-color':'#3c4043','text-halo-color':'#ffffff','text-halo-width':1.5} },
    { id:'water_name', type:'symbol', source:'openmaptiles', 'source-layer':'water_name', layout:{'text-field':['get','name'],'text-font':['Noto Sans Italic'],'text-size':12}, paint:{'text-color':'#4a90d9','text-halo-color':'#ffffff','text-halo-width':1} },
    { id:'poi', type:'symbol', source:'openmaptiles', 'source-layer':'poi', minzoom:13, layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':11,'icon-image':['concat','poi-', ['coalesce',['get','class'],'place-of-worship']],'icon-size':0.7,'text-offset':[0,1.2]}, paint:{'text-color':'#5f6368','text-halo-color':'#ffffff','text-halo-width':1} },
    { id:'boundary', type:'line', source:'openmaptiles', 'source-layer':'boundary', paint:{'line-color':'#9aa0a6','line-dasharray':[3,2],'line-width':1} }
  ]
} as const;
export type KidbusDayStyle = typeof KIDBUS_DAY_STYLE;

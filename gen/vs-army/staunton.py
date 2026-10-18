"""Tall Staunton pieces, turned on a lathe, for Chess Arcade's VS splash.

Blender -b --factory-startup -P staunton.py -- <white|black> <out.png> [samples] [scale%]
  (shipped at 384 samples, 100%), then
cwebp -q 80 -alpha_q 85 -m 6 out.png -o out.webp  -> VS_ARMY_ART in index.html
Composed with the clash on the right (+X): the page mirrors it for the right
half. Transparent film, shadow catcher floor, so the page's own backdrop
shows through."""
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
COLOR = argv[0]; OUT = argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 192
SCALE = int(argv[3]) if len(argv) > 3 else 100

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- profile -> lathe ----------
def catmull(pts, n=8):
    """pts: [(r,z,sharp)], smooth Catmull-Rom through runs between sharp points."""
    out = []
    runs, cur = [], [pts[0]]
    for p in pts[1:]:
        cur.append(p)
        if len(p) > 2 and p[2]:
            runs.append(cur); cur = [p]
    if len(cur) > 1: runs.append(cur)
    for run in runs:
        P = [(p[0], p[1]) for p in run]
        if len(P) == 2:
            seg = [P[0], P[1]]
            out.extend(seg if not out else seg[1:]); continue
        ext = [P[0]] + P + [P[-1]]
        res = []
        for i in range(1, len(ext) - 2):
            p0, p1, p2, p3 = ext[i-1], ext[i], ext[i+1], ext[i+2]
            for k in range(n):
                t = k / n
                t2, t3 = t*t, t*t*t
                r = 0.5*((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3)
                z = 0.5*((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)
                res.append((max(r, 0.0), z))
        res.append(P[-1])
        out.extend(res if not out else res[1:])
    return out

def finish_mesh(bm, angle=34):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle):
            e.smooth = False

def lathe(name, pts, steps=128):
    prof = catmull(pts)
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    es = [bm.edges.new((vs[i], vs[i+1])) for i in range(len(vs)-1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=steps, use_merge=True)
    finish_mesh(bm)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    return ob

def box(name, sx, sy, sz, loc, bevel=0.03):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x*sx, v.co.y*sy, v.co.z*sz))
    for f in bm.faces: f.smooth = True
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    ob.location = loc
    m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 4
    ob.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
    return ob

def sphere(name, r, loc):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
    for f in bm.faces: f.smooth = True
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    ob.location = loc
    return ob

def cutter(name, sx, sy, sz, loc, rot=(0, 0, 0)):
    ob = box(name, sx, sy, sz, loc, bevel=0.0)
    ob.modifiers.clear()
    ob.rotation_euler = rot
    ob.hide_render = True; ob.display_type = 'WIRE'
    return ob

def cut(target, c):
    m = target.modifiers.new('cut_' + c.name, 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'

S = True
BASE = [(0,0,S),(0.96,0,S),(1.01,0.04),(1.02,0.09),(0.99,0.14,S),(0.93,0.16,S),(0.95,0.21),(0.92,0.26,S),
        (0.85,0.28,S),(0.84,0.32),(0.85,0.36),(0.80,0.40,S)]
def scaled(pts, k):  # base scaled radially for smaller pieces
    return [(p[0]*k, p[1]*k) + tuple(p[2:]) for p in pts]

def collar(z, r1, r2, rin):
    return [(rin+0.08, z, S), (r1-0.03, z+0.05), (r1, z+0.10), (r1-0.04, z+0.15, S), (r2*0.82, z+0.18, S),
            (r2-0.02, z+0.22), (r2, z+0.27), (r2-0.04, z+0.31, S), (rin, z+0.34, S)]

def group(name, parts, loc, lean=0.0, turn=0.0):
    e = bpy.data.objects.new(name, None); scene.collection.objects.link(e)
    for p in parts: p.parent = e
    e.location = loc; e.rotation_euler = (0, math.radians(lean), math.radians(turn))
    return e

def king(tag):
    pts = BASE + [(0.72,0.44),(0.61,0.54),(0.54,0.70),(0.49,0.95),(0.44,1.35),(0.40,1.85),(0.37,2.35),(0.355,2.75,S)] \
        + collar(2.75, 0.62, 0.54, 0.36) \
        + [(0.37,3.22),(0.41,3.45),(0.49,3.75),(0.57,4.02),(0.64,4.24,S),(0.67,4.26),(0.685,4.32),(0.66,4.37,S),
           (0.57,4.38,S),(0.52,4.45),(0.42,4.56),(0.30,4.63),(0.20,4.67,S),(0.15,4.68,S),(0.175,4.72),(0.175,4.78),(0.13,4.82,S),(0,4.84,S)]
    body = lathe(tag+'K', pts)
    v = box(tag+'Kv', 0.19, 0.17, 0.80, (0, 0, 5.18))
    h = box(tag+'Kh', 0.62, 0.145, 0.19, (0, 0, 5.24))
    return [body, v, h]

def queen(tag):
    pts = BASE + [(0.72,0.44),(0.61,0.54),(0.54,0.70),(0.48,0.95),(0.43,1.35),(0.39,1.80),(0.36,2.25),(0.345,2.55,S)] \
        + collar(2.55, 0.60, 0.52, 0.35) \
        + [(0.36,3.0),(0.40,3.22),(0.48,3.50),(0.57,3.78),(0.66,4.02,S),(0.70,4.05),(0.71,4.11),(0.66,4.15,S),
           (0.50,4.13,S),(0.44,4.17),(0.38,4.27),(0.30,4.36),(0.16,4.42,S),(0.13,4.44,S),(0,4.45,S)]
    body = lathe(tag+'Q', pts)
    parts = [body]
    for i in range(12):
        a = i/12*math.tau
        parts.append(sphere(tag+'Qb%d' % i, 0.105, (0.60*math.cos(a), 0.62*math.sin(a), 4.17)))
    parts.append(sphere(tag+'Qf', 0.16, (0, 0, 4.58)))
    return parts

def bishop(tag):
    k = 0.92
    pts = scaled(BASE, k) + [(0.66,0.42),(0.56,0.52),(0.49,0.68),(0.44,0.92),(0.40,1.30),(0.36,1.70),(0.335,2.0,S)] \
        + collar(2.0, 0.55, 0.46, 0.32) \
        + [(0.30,2.40),(0.36,2.52),(0.42,2.70),(0.44,2.88),(0.42,3.08),(0.36,3.28),(0.27,3.45),(0.16,3.57),(0.08,3.62,S),
           (0.10,3.64,S),(0.13,3.70),(0.13,3.77),(0.08,3.82),(0,3.83,S)]
    body = lathe(tag+'B', pts)
    c = cutter(tag+'Bslit', 0.06, 1.2, 0.7, (0.18, 0, 3.12), (0, math.radians(38), 0))
    c.rotation_euler = (math.radians(0), math.radians(-40), 0)
    cut(body, c)
    parts = [body, sphere(tag+'Bf', 0.12, (0, 0, 3.92))]
    c.parent = None
    return parts, c

def rook(tag):
    k = 0.95
    pts = scaled(BASE, k) + [(0.70,0.44),(0.60,0.54),(0.55,0.70),(0.52,0.95),(0.49,1.30),(0.47,1.65),(0.46,1.90,S)] \
        + [(0.52,1.92,S),(0.60,1.96),(0.62,2.02,S),(0.58,2.05,S),(0.58,2.62,S),(0.62,2.64),(0.63,2.70),(0.60,2.74,S),
           (0.62,2.76,S),(0.62,3.0,S),(0.46,3.0,S),(0.46,2.80,S),(0,2.80,S)]
    body = lathe(tag+'R', pts)
    cs = []
    for i in range(3):
        c = cutter(tag+'Rn%d' % i, 0.17, 1.6, 0.4, (0, 0, 3.0), (0, 0, math.radians(i*60)))
        cut(body, c); cs.append(c)
    return [body], cs

def pawn(tag):
    k = 0.82
    pts = scaled(BASE, k) + [(0.60,0.37),(0.50,0.46),(0.44,0.62),(0.38,0.90),(0.33,1.20),(0.30,1.40,S),
                             (0.40,1.42,S),(0.47,1.46),(0.48,1.51),(0.44,1.55,S),(0.26,1.58,S)]
    pts += [(0.20,1.62,S)]
    body = lathe(tag+'P', pts)
    return [body, sphere(tag+'Pb', 0.36, (0, 0, 1.93))]

def knight(tag):
    k = 0.92
    pts = scaled(BASE, k) + [(0.66,0.42),(0.60,0.50),(0.58,0.60,S),(0,0.60,S)]
    base = lathe(tag+'Nb', pts)
    head = [(-0.48,0.55),(-0.54,1.10),(-0.52,1.60),(-0.44,2.05),(-0.30,2.45),(-0.14,2.72),(-0.06,2.98),(0.02,2.80),
            (0.18,2.74),(0.40,2.56),(0.60,2.30),(0.74,2.04),(0.76,1.90),(0.62,1.82),(0.42,1.90),(0.22,1.80),
            (0.18,1.55),(0.32,1.20),(0.46,0.80),(0.46,0.55)]
    t = 0.27
    bm = bmesh.new()
    vs = [bm.verts.new((x, -t, z)) for x, z in head]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    bmesh.ops.translate(bm, vec=(0, 2*t, 0), verts=[v for v in ext['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for fc in bm.faces: fc.smooth = True
    me = bpy.data.meshes.new(tag+'Nh'); bm.to_mesh(me); bm.free()
    h = bpy.data.objects.new(tag+'Nh', me); scene.collection.objects.link(h)
    m = h.modifiers.new('bev', 'BEVEL'); m.width = 0.12; m.segments = 5; m.limit_method = 'NONE'
    h.modifiers.new('ss', 'SUBSURF').levels = 2; h.modifiers['ss'].render_levels = 2
    return [base, h]

# ---------- materials ----------
def mat(name, col, rough, coat, coat_rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = coat_rough
    if col[0] < 0.1: b.inputs['Specular IOR Level'].default_value = 0.25
    return m
WHITE = COLOR == 'white'
M = mat('ivory', (0.70, 0.60, 0.44), 0.30, 0.6, 0.06) if WHITE else mat('ebony', (0.010, 0.009, 0.008), 0.30, 1.0, 0.03)

# ---------- the scene: clash to the right (+X), camera low and close ----------
cutters = []
army = []
army.append(group('king', king('k'), (0.38, 0.0, 0), lean=8.5))
army.append(group('queen', queen('q'), (-1.02, 1.05, 0), lean=6.0))
bp, bc = bishop('b'); cutters.append(bc)
army.append(group('bishop', bp, (-2.05, 3.6, 0), turn=-25))
army.append(group('knight', knight('n'), (1.55, 4.3, 0), turn=-12))
rp, rc = rook('r'); cutters += rc
army.append(group('rook', rp, (-0.35, 6.3, 0), turn=15))
army.append(group('pawn1', pawn('p1'), (0.85, 7.8, 0)))
army.append(group('pawn2', pawn('p2'), (-2.7, 7.0, 0)))
army.append(group('pawn3', pawn('p3'), (2.6, 8.6, 0)))
# cutters follow their piece (booleans evaluate in world space)
for c in cutters:
    owner = bpy.data.objects['bishop' if c.name.startswith('b') else 'rook']
    c.parent = owner
for ob in scene.objects:
    if ob.type == 'MESH' and not ob.hide_render:
        ob.data.materials.append(M)

floor = None
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40)
me = bpy.data.meshes.new('floor'); bm.to_mesh(me); bm.free()
floor = bpy.data.objects.new('floor', me); scene.collection.objects.link(floor)
floor.is_shadow_catcher = True

cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 50
cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam
cam.location = (0.05, -8.0, 1.0)
cam.rotation_euler = (math.radians(90 + 18.5), 0, 0)
cam_d.dof.use_dof = True
cam_d.dof.focus_object = bpy.data.objects['king']
cam_d.dof.focus_distance = 8.0
cam_d.dof.aperture_fstop = 0.32

def area(name, loc, target, power, color, size, tall=None):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = power; d.color = color; d.size = size
    if tall:  # a strip light: narrow and tall, for clean lines down each piece
        d.shape = 'RECTANGLE'; d.size_y = tall
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o

GOLD = (1.0, 0.78, 0.45)
if WHITE:
    area('key', (6.0, -2.6, 4.8), (0.6, 0, 3.2), 1500, (1.0, 0.95, 0.88), 1.2, 6.0)
    area('rimR', (4.4, 4.6, 4.0), (0.2, 0.5, 3.0), 900, GOLD, 0.5, 7.0)
    area('rimL', (-4.8, 4.2, 4.0), (-0.6, 0.8, 3.0), 160, (0.9, 0.92, 1.0), 0.5, 7.0)
else:
    area('key', (4.6, -4.2, 4.6), (0.6, 0, 3.2), 900, (1.0, 0.95, 0.88), 1.0, 6.0)
    area('rimR', (4.4, 4.6, 4.0), (0.2, 0.5, 3.0), 2600, GOLD, 0.45, 7.0)
    area('rimL', (-4.8, 4.2, 4.0), (-0.6, 0.8, 3.0), 1300, GOLD, 0.45, 7.0)
    area('fill', (-5.0, -6.0, 2.4), (-0.6, 0.5, 2.6), 40, (0.85, 0.9, 1.0), 4.0)

world = bpy.data.worlds.new('w'); scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0

r = scene.render
r.engine = 'CYCLES'
r.resolution_x, r.resolution_y, r.resolution_percentage = 720, 1200, SCALE
r.film_transparent = True
r.image_settings.file_format = 'PNG'; r.image_settings.color_mode = 'RGBA'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print('GPU setup failed', e)
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
except Exception:
    try: scene.view_settings.look = 'Punchy'
    except Exception as e: print('look', e)
if WHITE: scene.view_settings.exposure = -0.3
r.filepath = OUT
bpy.ops.render.render(write_still=True)
print('WROTE', OUT)

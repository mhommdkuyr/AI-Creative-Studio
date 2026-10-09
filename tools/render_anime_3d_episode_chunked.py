#!/usr/bin/env python3
"""Procedurally build and render a 60-second 3D anime fight in Blender 4.2+.

Run: blender --background --factory-startup --python tools/render_anime_3d_episode.py
Output: output/anime-episode-3d-silent.mp4, output/anime-episode-3d.blend,
        output/anime-episode-3d.srt, output/episode-script.json
"""
import bpy, math, os, json, random
from mathutils import Vector
from pathlib import Path

ROOT = Path(os.environ.get("GITHUB_WORKSPACE", Path(__file__).resolve().parents[1]))
OUT = ROOT / "output"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(42)

sc = bpy.context.scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.collections,):
    for item in list(datablocks):
        if item.users == 0: datablocks.remove(item)

def collection(name):
    c = bpy.data.collections.new(name); sc.collection.children.link(c); return c
RIGS=collection("01_CHARACTER_RIGS")
GEO=collection("02_CHARACTER_MESHES")
ENV=collection("03_ARENA_AND_CITY")
VFX=collection("04_ENERGY_VFX")
CAM=collection("05_CAMERAS_AND_LIGHTS")
INK=collection("06_IMPACT_INK")

sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x=int(os.environ.get("ANIME_RES_WIDTH","960")); sc.render.resolution_y=int(os.environ.get("ANIME_RES_HEIGHT","540")); sc.render.resolution_percentage=100
sc.render.fps=24; sc.render.fps_base=1.0; sc.frame_start=1; sc.frame_end=1440
sc.render.image_settings.file_format="FFMPEG"
sc.render.ffmpeg.format="MPEG4"; sc.render.ffmpeg.codec="H264"; sc.render.ffmpeg.constant_rate_factor="MEDIUM"
sc.render.ffmpeg.audio_codec="NONE"; sc.render.filepath=str(OUT/"anime-episode-3d-silent.mp4")
sc.render.use_file_extension=True
sc.render.resolution_percentage=100
sc.render.image_settings.color_mode="RGB"
sc.render.film_transparent=False
sc.render.engine="BLENDER_EEVEE_NEXT"
sc.render.image_settings.color_mode="RGB"
sc.view_settings.view_transform="AgX"
sc.render.use_sequencer=False
sc.world=bpy.data.worlds.new("Indigo Night Sky")
sc.world.use_nodes=True
world_bg=sc.world.node_tree.nodes.get("Background")
world_bg.inputs["Color"].default_value=(.003,.008,.028,1)
world_bg.inputs["Strength"].default_value=.35

def material(name, color, metal=0.0, rough=.42, emission=None, emit_strength=1.0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value=(*color,1)
    bs.inputs["Metallic"].default_value=metal; bs.inputs["Roughness"].default_value=rough
    if emission:
        bs.inputs["Emission Color"].default_value=(*emission,1)
        bs.inputs["Emission Strength"].default_value=emit_strength
    return m

MAT={
 "skin":material("Skin / warm porcelain",(.96,.67,.53),rough=.38),
 "hairblack":material("Hair / blue black",(.012,.018,.043),rough=.24),
 "hairgold":material("Hair / bright gold",(1,.62,.012),rough=.26),
 "yellow":material("Jacket / golden yellow",(1,.48,.012),rough=.44),
 "teal":material("Varsity / deep teal",(.015,.36,.38),rough=.36),
 "orange":material("Sleeves / coral orange",(.94,.19,.095),rough=.4),
 "pink":material("Shirt / magenta",(.78,.025,.28),rough=.48),
 "purple":material("Shirt / violet",(.23,.06,.42),rough=.5),
 "navy":material("Trousers / navy",(.027,.058,.17),rough=.65),
 "olive":material("Trousers / olive",(.18,.23,.075),rough=.66),
 "shoe":material("Sneakers / graphite",(.012,.019,.032),rough=.4),
 "white":material("Eyes / ivory",(1,.96,.86),rough=.25),
 "iris":material("Eyes / cyan",(0.015,.38,.76),rough=.22),
 "pupil":material("Eyes / pupil",(.002,.003,.008),rough=.2),
 "ink":material("Facial lines",(.012,.006,.016),rough=.55),
 "goldtrim":material("Gold trim",(1,.4,.015),metal=.58,rough=.25),
 "arena":material("Arena / obsidian",(.016,.028,.075),metal=.24,rough=.48),
 "ring":material("Arena / blue metal",(.05,.105,.23),metal=.5,rough=.3),
 "blue":material("Energy / electric blue",(.01,.16,1),metal=.1,rough=.2,emission=(.006,.12,1),emit_strength=3),
 "cyan":material("Energy / cyan",(.005,.68,1),metal=.05,rough=.2,emission=(.002,.42,1),emit_strength=3),
 "fire":material("Energy / blazing gold",(1,.19,.004),rough=.2,emission=(1,.12,.001),emit_strength=3),
 "pinkglow":material("Energy / magenta",(1,.01,.23),rough=.24,emission=(1,.005,.15),emit_strength=2.5),
 "dark":material("City / midnight",(.004,.008,.02),metal=.16,rough=.38),
 "whiteflash":material("Impact frame / paper white",(1,1,1),rough=1,emission=(1,1,1),emit_strength=2.5),
 "blackink":material("Impact frame / black ink",(0,0,0),rough=1,emission=(0,0,0)),
}
RIG_BY_NAME={}
BASE_X={"GIRL":-3.9,"DARK":-1.35,"BLOND":1.55}
BONES={
 "root":((0,0,.25),(0,0,.8),None),
 "pelvis":((0,0,.72),(0,0,1.3),"root"),
 "spine":((0,0,1.22),(0,0,1.95),"pelvis"),
 "chest":((0,0,1.88),(0,0,2.5),"spine"),
 "neck":((0,0,2.43),(0,0,2.8),"chest"),
 "head":((0,0,2.72),(0,0,3.65),"neck"),
 "jaw":((0,-.04,3.12),(0,-.23,3.3),"head"),
 "clavicle.L":((-.15,0,2.42),(-.4,0,2.43),"chest"),
 "upper_arm.L":((-.4,0,2.43),(-.7,0,2.15),"clavicle.L"),
 "forearm.L":((-.7,0,2.15),(-.88,-.02,1.9),"upper_arm.L"),
 "hand.L":((-.88,-.02,1.9),(-.99,-.05,1.8),"forearm.L"),
 "clavicle.R":((.15,0,2.42),(.4,0,2.43),"chest"),
 "upper_arm.R":((.4,0,2.43),(.7,0,2.15),"clavicle.R"),
 "forearm.R":((.7,0,2.15),(.88,-.02,1.9),"upper_arm.R"),
 "hand.R":((.88,-.02,1.9),(.99,-.05,1.8),"forearm.R"),
 "thigh.L":((-.22,0,1.15),(-.28,0,.68),"pelvis"),
 "shin.L":((-.28,0,.68),(-.3,0,.24),"thigh.L"),
 "foot.L":((-.3,0,.24),(-.3,-.3,.13),"shin.L"),
 "thigh.R":((.22,0,1.15),(.28,0,.68),"pelvis"),
 "shin.R":((.28,0,.68),(.3,0,.24),"thigh.R"),
 "foot.R":((.3,0,.24),(.3,-.3,.13),"shin.R"),
 "eye.L":((-.18,-.3,3.5),(-.18,-.4,3.5),"head"),
 "eye.R":((.18,-.3,3.5),(.18,-.4,3.5),"head"),
 "brow.L":((-.27,-.31,3.68),(-.08,-.33,3.7),"head"),
 "brow.R":((.08,-.33,3.7),(.27,-.31,3.68),"head"),
 "hair":((0,0,3.5),(0,0,4.1),"head"),
}
assert len(BONES)==26, f"Rig bone count unexpectedly changed: {len(BONES)}"

def bind_mesh(obj, bone_name, char_name):
    vg=obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))),1.0,"REPLACE")
    mod=obj.modifiers.new("Articulated anime armature","ARMATURE")
    mod.object=RIG_BY_NAME[char_name]
    return obj

def finalize_mesh(obj,name,material,bone_name,char_name,bevel=0):
    obj.name=name
    for old in list(obj.users_collection): old.objects.unlink(obj)
    GEO.objects.link(obj)
    if char_name is None:
        obj.location=(0,0,0)
    else:
        bx=BASE_X[char_name]; obj.location=(bx,0,0)
    obj.data.materials.append(material)
    for p in obj.data.polygons: p.use_smooth=True
    if bevel and obj.type=="MESH":
        mod=obj.modifiers.new("Soft silhouette edges","BEVEL"); mod.width=bevel; mod.segments=2
        obj.modifiers.new("Weighted normals","WEIGHTED_NORMAL")
    if bone_name and char_name:
        bind_mesh(obj,bone_name,char_name)
    return obj

def sphere(name,center,scale,mat,bone,char,segments=16,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=(0,0,0))
    o=bpy.context.object
    for v in o.data.vertices:
        v.co.x=v.co.x*scale[0]+center[0]; v.co.y=v.co.y*scale[1]+center[1]; v.co.z=v.co.z*scale[2]+center[2]
    return finalize_mesh(o,name,mat,bone,char)

def cube(name,center,dims,mat,bone,char,bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,0))
    o=bpy.context.object
    for v in o.data.vertices:
        v.co.x=v.co.x*dims[0]+center[0];v.co.y=v.co.y*dims[1]+center[1];v.co.z=v.co.z*dims[2]+center[2]
    return finalize_mesh(o,name,mat,bone,char,bevel)

def segment(name,head,tail,radius,mat,bone,char):
    h=Vector(head);t=Vector(tail);d=t-h
    bpy.ops.mesh.primitive_cylinder_add(vertices=14,radius=radius,depth=d.length,location=(0,0,0))
    o=bpy.context.object;q=Vector((0,0,1)).rotation_difference(d.normalized())
    for v in o.data.vertices:v.co=q@v.co+(h+t)/2
    o=finalize_mesh(o,name,mat,bone,char,radius*.12)
    return o

def curve_obj(name,points,mat,bevel,coll=VFX):
    cu=bpy.data.curves.new(name,"CURVE");cu.dimensions="3D";cu.resolution_u=2;cu.bevel_depth=bevel;cu.bevel_resolution=2
    spl=cu.splines.new("POLY");spl.points.add(len(points)-1)
    for p,co in zip(spl.points,points):p.co=(*co,1)
    o=bpy.data.objects.new(name,cu);coll.objects.link(o);o.data.materials.append(mat);return o

def create_rig(char,bx):
    data=bpy.data.armatures.new("RigData_"+char);arm=bpy.data.objects.new("RIG_"+char,data);RIGS.objects.link(arm);arm.location=(bx,0,0)
    arm.show_in_front=True;data.display_type="STICK";RIG_BY_NAME[char]=arm
    bpy.ops.object.select_all(action="DESELECT");arm.select_set(True);bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode="EDIT")
    for name,(head,tail,parent) in BONES.items():
        b=data.edit_bones.new(name);b.head=head;b.tail=tail
        if parent:b.parent=data.edit_bones.get(parent)
    bpy.ops.object.mode_set(mode="OBJECT")
    arm["character_id"]=char;arm["joint_count"]=len(BONES)
    arm["face_controls"]="jaw, head, eyes L/R, brows L/R; mouth visemes keyed"
    return arm

def build_character(char,bx,jacket,shirt,pants,hair,sleeve,hood=False,ponytail=False):
    create_rig(char,bx)
    P=lambda n,c,s,m,b="spine",d=16:sphere(char+"_"+n,c,s,m,b,char,d)
    B=lambda n,c,s,m,b="chest",be=.035:cube(char+"_"+n,c,s,m,b,char,be)
    T=lambda n,h,t,r,m,b:segment(char+"_"+n,h,t,r,m,b,char)
    for side,sgn in (("L",-1),("R",1)):
        T("thigh_"+side,(sgn*.23,0,1.16),(sgn*.28,0,.69),.16,MAT[pants],"thigh."+side)
        T("shin_"+side,(sgn*.28,0,.69),(sgn*.3,-.02,.23),.12,MAT[pants],"shin."+side)
        P("knee_"+side,(sgn*.28,-.01,.69),(.13,.14,.13),MAT[pants],"shin."+side)
        P("shoe_"+side,(sgn*.3,-.17,.15),(.22,.36,.14),MAT["shoe"],"foot."+side)
        B("sole_"+side,(sgn*.3,-.19,.075),(.42,.55,.06),MAT["goldtrim"],"foot."+side,.02)
        B("cargo_pocket_"+side,(sgn*.29,-.14,.87),(.2,.09,.22),MAT[pants],"thigh."+side)
        T("upper_arm_"+side,(sgn*.42,0,2.42),(sgn*.72,0,2.15),.15,MAT[sleeve],"upper_arm."+side)
        P("elbow_"+side,(sgn*.72,0,2.15),(.145,.15,.145),MAT[sleeve],"forearm."+side)
        T("forearm_"+side,(sgn*.72,0,2.15),(sgn*.89,-.03,1.91),.125,MAT[sleeve],"forearm."+side)
        P("hand_"+side,(sgn*.96,-.09,1.83),(.12,.13,.12),MAT["skin"],"hand."+side)
        for j in range(3):P("finger_"+side+str(j),(sgn*(.96+j*.025),-.14,1.8-j*.03),(.04,.06,.05),MAT["skin"],"hand."+side,12)
        T("wrist_cuff_"+side,(sgn*.85,-.04,1.98),(sgn*.93,-.06,1.9),.13,MAT["goldtrim"],"hand."+side)
    P("pelvis",(0,0,1.32),(.4,.3,.31),MAT[pants],"pelvis")
    P("torso",(0,0,1.9),(.47,.31,.63),MAT[jacket],"spine")
    P("jacket",(0,-.02,2.13),(.53,.33,.45),MAT[jacket],"chest")
    P("shirt",(0,-.31,2.06),(.28,.07,.38),MAT[shirt],"chest")
    P("neck",(0,0,2.69),(.16,.16,.18),MAT["skin"],"neck")
    P("head",(0,-.01,3.33),(.51,.43,.6),MAT["skin"],"head",22)
    P("ear.L",(-.5,-.02,3.35),(.11,.12,.15),MAT["skin"],"head")
    P("ear.R",(.5,-.02,3.35),(.11,.12,.15),MAT["skin"],"head")
    P("haircap",(0,.025,3.75),(.56,.45,.37),MAT[hair],"head",22)
    for i in range(12):
        x=-.48+i*.087;z=3.9+.1*math.sin(i*1.35)+(.04 if char=="BLOND" else 0)
        P("hairlock_"+str(i),(x,0,z),(.15,.23,.22),MAT[hair],"head")
    P("sidehair.L",(-.45,-.05,3.45),(.14,.23,.34),MAT[hair],"head")
    P("sidehair.R",(.45,-.05,3.45),(.14,.23,.34),MAT[hair],"head")
    for side,sgn in (("L",-1),("R",1)):
        T("brow_"+side,(sgn*.29,-.395,3.68),(sgn*.09,-.42,3.71),.026,MAT[hair],"brow."+side)
        P("eye_white_"+side,(sgn*.19,-.405,3.52),(.13,.04,.15),MAT["white"],"eye."+side)
        P("iris_"+side,(sgn*.19,-.443,3.52),(.07,.024,.088),MAT["iris"],"eye."+side)
        P("pupil_"+side,(sgn*.19,-.466,3.52),(.037,.014,.05),MAT["pupil"],"eye."+side,12)
        P("eye_glint_"+side,(sgn*.17,-.48,3.56),(.02,.01,.02),MAT["white"],"eye."+side,10)
    # Individually rigged jaw plus distinct closed/open mouth and phoneme parts.
    P("mouth_closed",(0,-.44,3.25),(.09,.02,.017),MAT["ink"],"jaw",14)
    P("mouth_open",(0,-.45,3.25),(.08,.023,.07),MAT["ink"],"jaw",14)
    P("mouth_teeth",(0,-.474,3.28),(.065,.01,.016),MAT["white"],"jaw",10)
    P("mouth_tongue",(0,-.473,3.22),(.04,.01,.016),MAT["pink"],"jaw",10)
    P("chest_star",(0,-.365,2.2),(.085,.025,.085),MAT["goldtrim"],"chest",12)
    B("belt",(0,-.03,1.47),(.56,.11,.07),MAT["dark"],"pelvis")
    B("belt_buckle",(0,-.09,1.47),(.12,.025,.075),MAT["goldtrim"],"pelvis")
    if hood:
        P("teal_hood",(0,.22,2.43),(.4,.2,.22),MAT["teal"],"chest")
        P("hood_inner",(0,-.13,2.43),(.25,.05,.16),MAT["purple"],"chest")
    if ponytail:
        P("ponytail",(.27,.23,4.0),(.22,.23,.45),MAT[hair],"head")
        P("hair_tie",(.2,.02,4.06),(.1,.12,.08),MAT["pink"],"head")
    if char=="BLOND":
        P("varsity_vest",(0,-.02,2.14),(.53,.34,.44),MAT["teal"],"chest")
        P("pink_undershirt",(0,-.355,2.07),(.26,.05,.34),MAT["pink"],"chest")
        for side,sgn in (("L",-1),("R",1)):
            B("coral_shoulder_"+side,(sgn*.48,-.01,2.39),(.22,.28,.19),MAT["orange"],"chest")
    arm=RIG_BY_NAME[char]
    arm["design"]= {"GIRL":"black ponytail, yellow jacket, purple shirt","DARK":"spiky black hair, yellow jacket, teal hood","BLOND":"spiky golden hair, teal varsity vest, coral sleeves, pink shirt"}[char]
    return arm

girl=build_character("GIRL",BASE_X["GIRL"],"yellow","purple","navy","hairblack","yellow",ponytail=True)
dark=build_character("DARK",BASE_X["DARK"],"yellow","purple","navy","hairblack","yellow",hood=True)
blond=build_character("BLOND",BASE_X["BLOND"],"teal","pink","olive","hairgold","orange")

def env_cylinder(name,loc,radius,depth,mat,vertices=96):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=bpy.context.object;o.name=name
    for old in list(o.users_collection):old.objects.unlink(o)
    ENV.objects.link(o);o.data.materials.append(mat)
    b=o.modifiers.new("Arena bevel","BEVEL");b.width=.08;b.segments=3
    o.modifiers.new("Weighted normals","WEIGHTED_NORMAL")
    return o

env_cylinder("ENV_duel_platform",(0,.3,-.2),5.85,.35,MAT["arena"])
env_cylinder("ENV_inner_ring",(0,.3,-.015),5.1,.08,MAT["ring"])
for radius,ma in ((5.2,MAT["cyan"]),(4.05,MAT["fire"]),(3.05,MAT["pinkglow"])):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=.026,major_segments=80,minor_segments=8,location=(0,.3,.045))
    o=bpy.context.object;o.name="ENV_neon_ring_"+str(radius)
    for old in list(o.users_collection):old.objects.unlink(o)
    ENV.objects.link(o);o.data.materials.append(ma)
for i in range(17):
    x=-9.5+i*1.18;h=2.3+(i*7%5)*.55
    env_cylinder("ENV_city_building_%02d"%i,(x,4,h/2),.44,h,MAT["dark"],8)
    bar=curve_obj("ENV_city_neon_%02d"%i,[(x-.35,3.55,.1),(x-.35,3.55,h*.88)],MAT["cyan"] if i%2==0 else MAT["pinkglow"],.018,ENV)
random.seed(11)
for i in range(24):
    x=random.uniform(-7,7);y=random.uniform(-1,4);z=random.uniform(.5,4.5)
    o=sphere("VFX_dust_%02d"%i,(x,y,z),(.025,.025,.025),MAT["cyan"] if i%3 else MAT["fire"],None,None,10)
    o.location=(x,y,z);o.keyframe_insert(data_path="location",frame=1)
    o.location.z+=random.uniform(.2,1);o.keyframe_insert(data_path="location",frame=1440)

def point_light(name,loc,color,power,radius):
    data=bpy.data.lights.new(name,"POINT");data.energy=power;data.color=color;data.shadow_soft_size=radius
    ob=bpy.data.objects.new(name,data);CAM.objects.link(ob);ob.location=loc;return ob
def area_light(name,loc,target,color,power,size):
    data=bpy.data.lights.new(name,"AREA");data.energy=power;data.color=color;data.shape="DISK";data.size=size
    ob=bpy.data.objects.new(name,data);CAM.objects.link(ob);ob.location=loc
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat("-Z","Y").to_euler();return ob
area_light("LGT_key",(0,-7,10),(0,0,2),(.65,.8,1),1400,7)
point_light("LGT_warm_rim",(3,1,5),(1,.15,.03),950,2)
point_light("LGT_blue_rim",(-5,2,4),(.01,.2,1),850,2)
area_light("LGT_face_fill",(0,-5,3),(0,0,2),(1,.62,.42),250,3)

def aim(ob,target):ob.rotation_euler=(Vector(target)-ob.location).to_track_quat("-Z","Y").to_euler()
camdata=bpy.data.cameras.new("CAM_fight_data");camera=bpy.data.objects.new("CAM_fight",camdata);CAM.objects.link(camera);camera.location=(0,-17,6.5);camdata.lens=48;aim(camera,(0,.2,2.2));sc.camera=camera
shots=[
(1,(0,-17,6.5),(0,.2,2.2),48),(145,(-2.5,-11,4.5),(-2,0,2.8),65),
(250,(-1.5,-9,4.2),(-1,0,2.8),70),(360,(0,-12,3.7),(0,0,2.2),53),
(480,(0,-10,5),(0,0,2.2),48),(620,(.8,-10,4.8),(0,0,2.1),57),
(760,(0,-9,3.1),(0,0,2.3),49),(900,(0,-14,5.7),(0,0,2.4),52),
(1080,(0,-9,4.2),(0,0,2.25),65),(1210,(0,-10,3),(0,0,2.4),49),
(1320,(0,-16,6.2),(0,.2,2.2),45),(1440,(0,-16,6.2),(0,.2,2.2),45)]
for f,loc,target,lens in shots:
    camera.location=loc;aim(camera,target);camera.keyframe_insert(data_path="location",frame=f);camera.keyframe_insert(data_path="rotation_euler",frame=f)
    camdata.lens=lens;camdata.keyframe_insert(data_path="lens",frame=f)
    sc.timeline_markers.new("SHOT_%02d"%f,frame=f).camera=camera

def key_root(ch,t,x,z=0,rz=0):
    arm=RIG_BY_NAME[ch];f=round(t*24)+1
    arm.location=(BASE_X[ch]+x,0,z)
    arm.rotation_euler.z=math.radians(rz)
    arm.keyframe_insert(data_path="location",frame=f,group="Root")
    arm.keyframe_insert(data_path="rotation_euler",frame=f,group="Root")

def bone_key(ch,t,bone,axis,deg):
    pb=RIG_BY_NAME[ch].pose.bones.get(bone)
    if not pb:return
    pb.rotation_mode="XYZ";pb.rotation_euler[axis]=math.radians(deg)
    pb.keyframe_insert(data_path="rotation_euler",frame=round(t*24)+1,group=bone)

def pose(ch,t,values):
    for bn,vals in values.items():
        for axis,v in enumerate(vals):
            if v is not None:bone_key(ch,t,bn,axis,v)

root_tracks={
"GIRL":[(0,0,0,0),(6,.15,0,2),(16,-.1,0,-2),(25,.2,0,1),(35,0,0,0),(47,.25,0,-2),(56,.1,0,2),(60,0,0,0)],
"DARK":[(0,0,0,0),(4,0,0,0),(7,.2,0,-5),(9,.78,0,-12),(10.2,1.1,.3,-18),(11.2,.4,0,6),(14,.75,.1,-10),(17,.2,0,5),(20,.95,.45,-15),(22,.25,0,8),(25,.9,.15,-12),(28,.15,0,8),(31,.9,.7,-18),(33,0,0,7),(36,.8,.35,-14),(39,.1,0,8),(42,.85,.65,-16),(44,.2,0,7),(47,.9,.5,-13),(50,.15,0,8),(53,.8,.4,-15),(56,.45,0,8),(58,.95,.25,-12),(59.5,.6,0,0),(60,.6,0,0)],
"BLOND":[(0,0,0,0),(3.2,-.15,0,0),(5.2,-.4,0,4),(7,-.6,0,5),(9,-.93,0,12),(10.2,-1.1,.2,18),(11.2,-.5,0,-6),(14,-.95,.2,10),(17,-.3,0,-5),(20,-1.05,.6,15),(22,-.35,0,-8),(25,-1.0,.2,12),(28,-.2,0,-8),(31,-.95,.75,18),(33,-.15,0,-7),(36,-.95,.4,14),(39,-.2,0,-8),(42,-.9,.65,16),(44,-.35,0,-7),(47,-1.05,.55,13),(50,-.15,0,-8),(53,-.9,.45,15),(56,-.5,0,-8),(58,-1.0,.25,12),(59.5,-.6,0,0),(60,-.6,0,0)]}
for ch,track in root_tracks.items():
    for t,x,z,r in track:key_root(ch,t,x,z,r)

events=[
(7.7,"DARK","upper_arm.R",85,"forearm.R",-35),(8.5,"BLOND","forearm.L",70,"upper_arm.L",-42),
(9.3,"DARK","upper_arm.L",-78,"forearm.L",32),(10.0,"BLOND","upper_arm.R",-85,"forearm.R",38),
(11.5,"DARK","thigh.R",58,"shin.R",-34),(12.2,"BLOND","thigh.L",-70,"shin.L",28),
(13.2,"BLOND","upper_arm.L",86,"forearm.L",-42),(14.0,"DARK","forearm.R",82,"upper_arm.R",-38),
(15.2,"DARK","thigh.L",-60,"shin.L",24),(16.0,"BLOND","thigh.R",66,"shin.R",-30),
(18.3,"BLOND","upper_arm.R",95,"forearm.R",-48),(19.1,"DARK","forearm.L",-92,"upper_arm.L",45),
(21.0,"DARK","thigh.R",72,"shin.R",-42),(21.8,"BLOND","thigh.L",-74,"shin.L",36),
(24.0,"BLOND","upper_arm.L",-102,"forearm.L",54),(24.8,"DARK","upper_arm.R",108,"forearm.R",-54),
(27.4,"DARK","forearm.R",-105,"upper_arm.R",42),(28.2,"BLOND","forearm.L",102,"upper_arm.L",-40),
(30.4,"DARK","upper_arm.L",-112,"forearm.L",50),(31.2,"BLOND","upper_arm.R",118,"forearm.R",-58),
(34.1,"BLOND","thigh.R",84,"shin.R",-45),(35.0,"DARK","thigh.L",-86,"shin.L",44),
(37.4,"DARK","upper_arm.R",120,"forearm.R",-60),(38.2,"BLOND","upper_arm.L",-120,"forearm.L",62),
(40.5,"BLOND","thigh.L",-96,"shin.L",48),(41.4,"DARK","thigh.R",94,"shin.R",-52),
(44.0,"DARK","forearm.L",-115,"upper_arm.L",52),(44.9,"BLOND","forearm.R",115,"upper_arm.R",-52),
(47.1,"DARK","upper_arm.R",125,"forearm.R",-65),(48.0,"BLOND","upper_arm.L",-128,"forearm.L",66),
(50.0,"BLOND","thigh.R",105,"shin.R",-52),(50.9,"DARK","thigh.L",-105,"shin.L",56),
(53.3,"DARK","upper_arm.L",-132,"forearm.L",70),(54.1,"BLOND","upper_arm.R",135,"forearm.R",-68),
(57.8,"DARK","upper_arm.R",140,"forearm.R",-75),(58.5,"BLOND","upper_arm.L",-140,"forearm.L",75)]
for t,ch,b1,a1,b2,a2 in events:
    pose(ch,max(0,t-.25),{b1:(None,a1*.12,a1*.08),b2:(None,a2*.12,a2*.08),"spine":(None,None,-a1*.06),"head":(None,None,a1*.035)})
    pose(ch,t,{b1:(None,a1*.55,a1*.45),b2:(None,a2*.6,a2*.3),"spine":(None,None,-a1*.14),"head":(None,None,a1*.06)})
    pose(ch,t+.15,{b1:(None,a1,a1*.6),b2:(None,a2,a2*.6),"spine":(None,None,-a1*.22),"head":(None,None,a1*.1)})
    pose(ch,t+.33,{b1:(None,a1*.35,a1*.25),b2:(None,a2*.4,a2*.2),"spine":(None,None,-a1*.06),"head":(None,None,a1*.025)})
    pose(ch,t+.58,{b1:(0,0,0),b2:(0,0,0),"spine":(0,0,0),"head":(0,0,0)})
for ch in ("DARK","BLOND"):
    for t,ang in [(6,12),(17,18),(26,-12),(33,22),(43,-16),(52,12),(56,-8),(60,0)]:
        pose(ch,t,{"upper_arm.L":(None,ang,ang),"upper_arm.R":(None,-ang,-ang),"forearm.L":(None,-ang*.5,-ang*.2),"forearm.R":(None,ang*.5,ang*.2),"head":(0,0,-ang*.35)})

# Speech timings: both Arabic dialogue and facial controls use the same authored timecode.
dialogue=[
(4.4,6.7,"GIRL","أنا لست جائزة لأحد! سأختار بنفسي."),
(6.8,8.5,"DARK","ابتعد عنها! إن أردت التحدي، واجهني!"),
(8.8,10.4,"BLOND","لن أتراجع! أرني قوتك!"),
(12.8,14.5,"DARK","فلنرَ القوة الحقيقية!"),
(16.0,17.8,"GIRL","أوقفا هذا الجنون!"),
(18.3,20.1,"BLOND","هذا ليس سوى البداية!"),
(23.6,25.6,"DARK","لن تمر من هنا!"),
(29.4,31.5,"BLOND","جرّب صدّ هذه الضربة!"),
(32.3,34.6,"GIRL","كفى! أنتما لا تفهمان شيئاً!"),
(39.2,41.1,"BLOND","طاقتي لم تنفد بعد!"),
(43.3,45.3,"DARK","لن أحني رأسي لك!"),
(52.5,54.5,"BLOND","الهجمة الأخيرة!"),
(55.2,58.2,"GIRL","توقفا! القوة ليست كل شيء!"),
(56.2,58.1,"DARK","هذا لم ينتهِ بعد!")
]
for ch in ("GIRL","DARK","BLOND"):
    closed=bpy.data.objects[ch+"_mouth_closed"];opened=bpy.data.objects[ch+"_mouth_open"]
    teeth=bpy.data.objects[ch+"_mouth_teeth"];tongue=bpy.data.objects[ch+"_mouth_tongue"]
    for ob in (closed,opened,teeth,tongue):
        default_hide=(ob!=closed)
        keys=[(1,default_hide)]
        for start,end,speaker,text in dialogue:
            if speaker!=ch:continue
            keys += [(round(start*24)+1,ob==closed),(round((start+.08)*24)+1,ob==closed),
                     (round(end*24)+1,default_hide),(round((end+.08)*24)+1,default_hide)]
        for f,h in keys:ob.hide_render=h;ob.keyframe_insert(data_path="hide_render",frame=f)
    for start,end,speaker,text in dialogue:
        if speaker==ch:
            for tt,a in [(start,0),(start+.12,12),(start+.28,4),(start+.43,14),(start+.6,0),(start+.75,10),(end,0)]:
                bone_key(ch,tt,"jaw",0,a)

def key_visibility(obj, states):
    for f,hide in states:obj.hide_render=hide;obj.keyframe_insert(data_path="hide_render",frame=f)
    if obj.animation_data and obj.animation_data.action:
        try:
            for layer in obj.animation_data.action.layers:
                for strip in layer.strips:
                    for bag in strip.channelbags:
                        for fc in bag.fcurves:
                            if "hide_render" in fc.data_path:
                                for kp in fc.keyframe_points:kp.interpolation="CONSTANT"
        except Exception: pass

# Energy arcs: individually animated visibility and scale, positioned between the fighters.
def energy_arc(name,mat,base,phase=0):
    pts=[]
    for i in range(40):
        t=i/39
        pts.append((base[0]+t*2.4,base[1]-.12*math.sin(t*math.pi*2+phase),base[2]+math.sin(t*math.pi*2+phase)*.48))
    arc=curve_obj(name,pts,mat,.035 if "beam" in name else .018)
    for f,h in [(1,True),(round(7*24)+1,True),(round(8*24)+1,False),(round(10.8*24)+1,True),
                (round(18*24)+1,True),(round(19*24)+1,False),(round(21*24)+1,True),
                (round(29*24)+1,True),(round(30*24)+1,False),(round(33*24)+1,True),
                (round(47*24)+1,True),(round(48*24)+1,False),(round(51*24)+1,True),
                (round(58.9*24)+1,True),(round(59.1*24)+1,False),(1440,True)]:
        arc.hide_render=h;arc.keyframe_insert(data_path="hide_render",frame=f)
    return arc
for i in range(5):
    energy_arc("VFX_blue_beam_%d"%i,MAT["blue"],(-1.2+i*.09,-.6,2.6+i*.12),i*.35)
for i in range(5):
    energy_arc("VFX_gold_beam_%d"%i,MAT["fire"],(.05+i*.09,-.72,2.6-i*.1),i*.55)
for idx,sec in enumerate([8.1,10.1,13.7,19.0,21.6,24.9,30.8,34.6,38.0,41.0,44.6,48.0,51.0,58.95]):
    orb=sphere("VFX_hit_orb_%02d"%idx,(0,-.65,2.3),(.1,.1,.1),MAT["cyan"] if idx%2==0 else MAT["fire"],None,None,12)
    states=[(1,True),(round(max(0,sec-.07)*24)+1,True),(round(sec*24)+1,False),(round((sec+.14)*24)+1,True),(1440,True)]
    key_visibility(orb,states)
    for f,scale in [(max(1,round(sec*24)),(.04,.04,.04)),(round(sec*24)+1,(.7,.25,.7)),(round((sec+.08)*24)+1,(1.2,.2,1.2)),(round((sec+.14)*24)+1,(.02,.02,.02))]:
        orb.scale=scale;orb.keyframe_insert(data_path="scale",frame=f)

# Impact frames: coloured contact, exactly three white/black ink frames, then color resumes.
impact_frames=[1429,1430,1431]
char_meshes=[o for o in bpy.data.objects if o.type=="MESH" and any(o.name.startswith(ch+"_") for ch in ("GIRL","DARK","BLOND"))]
char_mats=[]
for o in char_meshes:
    for m in o.data.materials:
        if m and m not in char_mats:char_mats.append(m)
for m in char_mats:
    m.use_nodes=True;bs=m.node_tree.nodes.get("Principled BSDF")
    if not bs:continue
    normal=tuple(bs.inputs["Base Color"].default_value); enormal=tuple(bs.inputs["Emission Color"].default_value); estr=float(bs.inputs["Emission Strength"].default_value)
    for f,c in [(1,normal),(1428,normal),(1429,(1,1,1,1)),(1431,(1,1,1,1)),(1432,normal),(1440,normal)]:
        bs.inputs["Base Color"].default_value=c;bs.inputs["Base Color"].keyframe_insert(data_path="default_value",frame=f)
    for f,c in [(1,enormal),(1428,enormal),(1429,(1,1,1,1)),(1431,(1,1,1,1)),(1432,enormal),(1440,enormal)]:
        bs.inputs["Emission Color"].default_value=c;bs.inputs["Emission Color"].keyframe_insert(data_path="default_value",frame=f)
    for f,v in [(1,estr),(1428,estr),(1429,1.6),(1431,1.6),(1432,estr),(1440,estr)]:
        bs.inputs["Emission Strength"].default_value=v;bs.inputs["Emission Strength"].keyframe_insert(data_path="default_value",frame=f)
# Black world and clear the set/energy only during the white-silhouette impact.
for o in list(ENV.objects)+list(VFX.objects):
    key_visibility(o,[(1,False),(1428,False),(1429,True),(1431,True),(1432,False),(1440,False)])
for f,c in [(1,(.003,.008,.028,1)),(1428,(.003,.008,.028,1)),(1429,(0,0,0,1)),(1431,(0,0,0,1)),(1432,(.003,.008,.028,1)),(1440,(.003,.008,.028,1))]:
    world_bg.inputs["Color"].default_value=c;world_bg.inputs["Color"].keyframe_insert(data_path="default_value",frame=f)
for i in range(34):
    x=random.uniform(-3.2,3.0);z=random.uniform(.3,4.9);dx=random.uniform(.2,1.3);dz=random.uniform(-.55,.55)
    ink=curve_obj("IMPACT_INK_%02d"%i,[(x,-6,z),(x+dx,-6,z+dz)],MAT["blackink"],random.uniform(.008,.02),INK)
    key_visibility(ink,[(1,True),(1428,True),(1429,False),(1431,False),(1432,True),(1440,True)])
for f,dx in [(1426,0),(1428,.04),(1429,-.14),(1430,.16),(1431,-.08),(1432,.04),(1433,0),(1440,0)]:
    camera.location.x=dx;camera.keyframe_insert(data_path="location",frame=f)

# Make pose curves eased, visibility switches stepped.
def set_interpolation(action, path, mode):
    if not action:return
    try:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for fc in bag.fcurves:
                        if path in fc.data_path:
                            for kp in fc.keyframe_points:kp.interpolation=mode
    except Exception: pass
for ob in list(bpy.data.objects):
    if ob.animation_data and ob.animation_data.action:
        set_interpolation(ob.animation_data.action,"hide_render","CONSTANT")
for m in bpy.data.materials:
    if m.node_tree and m.node_tree.animation_data and m.node_tree.animation_data.action:
        set_interpolation(m.node_tree.animation_data.action,"default_value","CONSTANT")

# Arabic dialogue subtitle cue sheet; speech is synthesized and separately mixed in the workflow.
def srt_time(sec):
    ms=round(sec*1000); h=ms//3600000;ms%=3600000;mi=ms//60000;ms%=60000;s=ms//1000;ms%=1000
    return f"{h:02d}:{mi:02d}:{s:02d},{ms:03d}"
srt=[]
for i,(start,end,speaker,text) in enumerate(dialogue,1):
    srt += [str(i),f"{srt_time(start)} --> {srt_time(end)}",text,""]
(OUT/"anime-episode-3d.srt").write_text("\n".join(srt),encoding="utf-8")
script_data={"title":"تحدّي القوة — حلقة 3D كاملة","duration_seconds":60,"fps":24,"frames":1440,
 "resolution":[960,540],"impact_frames_zero_based":[1428,1429,1430],"colour_returns_zero_based":1431,
 "characters":[{"id":"GIRL","bones":26,"appearance":"black ponytail, yellow jacket, violet shirt"},
 {"id":"DARK","bones":26,"appearance":"spiky black hair, yellow jacket and teal hood"},
 {"id":"BLOND","bones":26,"appearance":"spiky gold hair, teal varsity vest, coral sleeves"}],
 "fight_events":[{"time":t,"attacker":ch,"move":b1} for t,ch,b1,a1,b2,a2 in events],
 "dialogue":[{"start":s,"end":e,"speaker":ch,"text":tx} for s,e,ch,tx in dialogue],
 "render":"Blender Eevee Next, 960x540, H.264"}
(OUT/"episode-script.json").write_text(json.dumps(script_data,ensure_ascii=False,indent=2),encoding="utf-8")
# Save a complete editable 60-second scene before restricting the render range to a chunk.
sc.frame_start=1; sc.frame_end=1440; sc.render.fps=24; sc.render.fps_base=1.0
sc.render.filepath=str(OUT/"anime-episode-3d-silent.mp4")
sc.frame_set(1)
if os.environ.get("ANIME_SAVE_BLEND","1") == "1":
    temp_w,temp_h=sc.render.resolution_x,sc.render.resolution_y
    sc.render.resolution_x,sc.render.resolution_y=960,540
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"anime-episode-3d.blend"))
    sc.render.resolution_x,sc.render.resolution_y=temp_w,temp_h
render_start=int(os.environ.get("ANIME_FRAME_START","1"))
render_end=int(os.environ.get("ANIME_FRAME_END","1440"))
if not (1 <= render_start <= render_end <= 1440):
    raise ValueError(f"Invalid render chunk {render_start}-{render_end}")
sc.frame_start=render_start; sc.frame_end=render_end
sc.render.filepath=os.environ.get("ANIME_CHUNK_OUTPUT",str(OUT/"anime-episode-3d-silent.mp4"))
sc.frame_set(render_start)
print("STARTING_RENDER_CHUNK",render_start,render_end,"of 1440",flush=True)
bpy.ops.render.render(animation=True)
print(json.dumps({"saved_blend":str(OUT/"anime-episode-3d.blend"),"video":sc.render.filepath,"fps":sc.render.fps,"render_start":render_start,"render_end":render_end,"chunk_frames":render_end-render_start+1,"duration_seconds":(render_end-render_start+1)/sc.render.fps,"bones":{n:len(RIG_BY_NAME[n].data.bones) for n in RIG_BY_NAME},"character_meshes":len(char_meshes),"events":len(events),"dialogue_lines":len(dialogue),"impact_frames":impact_frames},ensure_ascii=False))

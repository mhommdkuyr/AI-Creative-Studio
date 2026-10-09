#!/usr/bin/env python3
"""Blender 4.2+ builder for the three-character episode. Requires the extracted episode package.

Usage:
  blender --background --python tools/blender_episode2_rig.py -- --project-root /path/to/episode-02-project
  blender --background --python tools/blender_episode2_rig.py -- --project-root /path/to/episode-02-project --render
Optional review-only mocap imports: --mixamo animation.fbx --bvh motion.bvh
"""
import bpy, os, sys, json, math, argparse, random
from mathutils import Vector

def args_parse():
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    p=argparse.ArgumentParser()
    p.add_argument("--project-root", default=os.environ.get("ANIME_EPISODE_ROOT",""))
    p.add_argument("--render", action="store_true")
    p.add_argument("--mixamo")
    p.add_argument("--bvh")
    p.add_argument("--mmd-model")
    p.add_argument("--mmd-vmd")
    return p.parse_args(argv)

def link_collection(name):
    c=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c

def active(obj):
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True); bpy.context.view_layer.objects.active=obj

def emission_material(name, image_path=None, white=False):
    m=bpy.data.materials.new(name); m.use_nodes=True
    n=m.node_tree.nodes; l=m.node_tree.links; n.clear()
    out=n.new("ShaderNodeOutputMaterial")
    if image_path:
        tex=n.new("ShaderNodeTexImage"); tex.image=bpy.data.images.load(image_path,check_existing=True)
        emit=n.new("ShaderNodeEmission")
        if white: emit.inputs["Color"].default_value=(1,1,1,1)
        else: l.new(tex.outputs["Color"],emit.inputs["Color"])
        emit.inputs["Strength"].default_value=1
        transparent=n.new("ShaderNodeBsdfTransparent")
        mix=n.new("ShaderNodeMixShader")
        l.new(tex.outputs["Alpha"],mix.inputs[0]); l.new(transparent.outputs[0],mix.inputs[1]); l.new(emit.outputs[0],mix.inputs[2]); l.new(mix.outputs[0],out.inputs["Surface"])
        try: m.surface_render_method="DITHERED"
        except Exception: pass
    else:
        emit=n.new("ShaderNodeEmission"); emit.inputs["Color"].default_value=(0,0,0,1); l.new(emit.outputs[0],out.inputs["Surface"])
    return m

def visibility(obj, pairs):
    for fr,hide in pairs:
        obj.hide_render=hide; obj.keyframe_insert(data_path="hide_render",frame=fr)
    if obj.animation_data and obj.animation_data.action:
        try:
            for fc in obj.animation_data.action.fcurves:
                for kp in fc.keyframe_points: kp.interpolation="CONSTANT"
        except Exception: pass

def make_part_mesh(part_name, part, rig, anchor):
    x0,y0,x1,y1=part["bbox"]; ax,ay=anchor
    y=-.12*float(part.get("z",0))
    verts=[(x0-ax,y,ay-y0),(x1-ax,y,ay-y0),(x1-ax,y,ay-y1),(x0-ax,y,ay-y1)]
    mesh=bpy.data.meshes.new(part_name+"Mesh"); mesh.from_pydata(verts,[],[(0,1,2,3)]); mesh.update()
    uv=mesh.uv_layers.new(name="UVMap")
    for loop,coord in zip(uv.data,[(0,1),(1,1),(1,0),(0,0)]): loop.uv=coord
    return mesh

def make_armature(char, rig, coll):
    ax,ay=rig["root_anchor"]
    ad=bpy.data.armatures.new("Rig "+char); arm=bpy.data.objects.new("ARMATURE "+char,ad); coll.objects.link(arm)
    active(arm); bpy.ops.object.mode_set(mode="EDIT")
    master=ad.edit_bones.new("MASTER"); master.head=(0,0,0); master.tail=(0,0,80)
    for name,b in rig["bones"].items():
        eb=ad.edit_bones.new(name); hx,hy=b["head"]; tx,ty=b["tail"]
        eb.head=(hx-ax,0,ay-hy); eb.tail=(tx-ax,0,ay-ty); eb.use_connect=False
        eb.parent=ad.edit_bones.get(b["parent"]) if b.get("parent") else master
        try: eb.align_roll(Vector((0,1,0)))
        except Exception: pass
    bpy.ops.object.mode_set(mode="OBJECT"); arm.show_in_front=True; arm.data.display_type="STICK"
    arm["character_id"]=char; arm["joint_count"]=len(rig["bones"])
    return arm

def make_part(char, rig, name, part, arm, coll, project_root, white=False):
    path=os.path.join(project_root,part["file"])
    if not os.path.isfile(path): raise FileNotFoundError(path)
    mesh=make_part_mesh(char+"_"+name,part,rig,rig["root_anchor"])
    ob=bpy.data.objects.new(char+" / "+name+(" / IMPACT WHITE" if white else ""),mesh); coll.objects.link(ob)
    ob.data.materials.append(emission_material(ob.name+" Material",path,white))
    vg=ob.vertex_groups.new(name=part["bone"]); vg.add(list(range(4)),1.0,"REPLACE")
    mod=ob.modifiers.new("Rigid cutout bone","ARMATURE"); mod.object=arm
    ob.parent=arm; ob.matrix_parent_inverse=arm.matrix_world.inverted()
    return ob

def make_background(project_root,coll):
    path=os.path.join(project_root,"assets","arena_background.png")
    if not os.path.exists(path): return None
    mesh=bpy.data.meshes.new("ArenaPlate")
    mesh.from_pydata([(-640,110,360),(640,110,360),(640,110,-360),(-640,110,-360)],[],[(0,1,2,3)]); mesh.update()
    uv=mesh.uv_layers.new(name="UVMap")
    for lp,coord in zip(uv.data,[(0,1),(1,1),(1,0),(0,0)]): lp.uv=coord
    ob=bpy.data.objects.new("Arena background",mesh); coll.objects.link(ob); ob.data.materials.append(emission_material("Arena plate",path))
    visibility(ob,[(1,False),(192,False),(193,False),(194,True),(196,True),(197,False),(600,False)])
    return ob


def impact_ink(coll):
    def material(name,color):
        mat=bpy.data.materials.new(name); mat.use_nodes=True
        nodes=mat.node_tree.nodes; links=mat.node_tree.links; nodes.clear()
        out=nodes.new("ShaderNodeOutputMaterial"); em=nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value=(*color,1); em.inputs["Strength"].default_value=1
        links.new(em.outputs[0],out.inputs["Surface"])
        return mat
    ink=material("Impact Ink • Black",(0,0,0)); speed=material("Impact Slash • White",(1,1,1))
    rng=random.Random(193195)
    def line(name, pts, mat, width):
        curve=bpy.data.curves.new(name,"CURVE"); curve.dimensions="3D"; curve.resolution_u=1
        curve.bevel_depth=width; curve.bevel_resolution=0
        spline=curve.splines.new("POLY"); spline.points.add(len(pts)-1)
        for p,co in zip(spline.points,pts): p.co=(co[0],-40,co[1],1)
        ob=bpy.data.objects.new(name,curve); coll.objects.link(ob); ob.data.materials.append(mat)
        visibility(ob,[(1,True),(192,True),(193,True),(194,False),(196,False),(197,True),(600,True)])
        return ob
    for i in range(50):
        x=rng.uniform(-150,150); z=rng.uniform(-280,90); length=rng.uniform(10,48); dz=rng.uniform(-12,14)
        line("Impact hatch %02d"%i,[(x,z),(x+length,z+dz)],ink,rng.choice([.7,1.0,1.4]))
    for i in range(16):
        x=rng.uniform(-150,120); z=rng.uniform(-165,95); length=rng.uniform(65,185); dz=rng.uniform(-90,90)
        line("Impact speed slash %02d"%i,[(x,z),(x+length,z+dz)],speed,rng.uniform(1.0,2.8))

def attach_score(scene, root):
    sound=os.path.join(root,"output","episode-02-instrumental-sfx.wav")
    if not os.path.isfile(sound):
        print("Score WAV missing; save a silent Blender scene:", sound); return
    try:
        se=scene.sequence_editor_create()
        strips=getattr(se,"strips",None) or getattr(se,"sequences",None)
        strips.new_sound("Original Score and SFX",sound,channel=1,frame_start=1)
    except Exception as exc:
        print("Could not attach score automatically:",repr(exc))

def camera_setup(scene,coll):
    data=bpy.data.cameras.new("Cinematic fight camera"); cam=bpy.data.objects.new("CAMERA fight",data); coll.objects.link(cam)
    cam.rotation_euler=(math.radians(90),0,0); cam.data.type="ORTHO"; cam.data.ortho_scale=1280; cam.data.clip_start=1; cam.data.clip_end=5000; scene.camera=cam
    shots=[(0,0,-35,1280),(3.8,70,-45,1190),(7,42,-70,1110),(7.73,62,-72,940),(9.2,18,-66,1090),(11.5,45,-65,1010),(14.4,46,-40,1000),(16.5,38,-70,990),(18.7,58,-50,935),(21.8,45,-56,970),(23.05,48,-70,870),(23.45,45,-60,940),(25,30,-45,1120)]
    for t,x,z,scale in shots:
        f=round(t*24)+1; cam.location=(x,-1500,z); cam.keyframe_insert(data_path="location",frame=f); data.ortho_scale=scale; data.keyframe_insert(data_path="ortho_scale",frame=f)
    return cam

def import_motion(args,coll):
    imported=[]
    for path,kind in [(args.mixamo,"fbx"),(args.bvh,"bvh")]:
        if not path: continue
        if not os.path.isfile(path): raise FileNotFoundError(path)
        before=set(bpy.data.objects)
        if kind=="fbx": bpy.ops.import_scene.fbx(filepath=path,use_anim=True)
        else: bpy.ops.import_anim.bvh(filepath=path,axis_forward="-Z",axis_up="Y")
        for ob in set(bpy.data.objects)-before:
            for old in list(ob.users_collection): old.objects.unlink(ob)
            coll.objects.link(ob)
        imported.append(path)
    if args.mmd_model:
        if not hasattr(bpy.ops,"mmd_tools") or not hasattr(bpy.ops.mmd_tools,"import_model"):
            print("MMD Tools is not installed; skipping PMX/VMD input.")
        else:
            before=set(bpy.data.objects); bpy.ops.mmd_tools.import_model(filepath=args.mmd_model)
            for ob in set(bpy.data.objects)-before:
                for old in list(ob.users_collection): old.objects.unlink(ob)
                coll.objects.link(ob)
            if args.mmd_vmd and hasattr(bpy.ops.mmd_tools,"import_motion"): bpy.ops.mmd_tools.import_motion(filepath=args.mmd_vmd)
            imported.append(args.mmd_model)
    print("Review-only external motion inputs; manual retargeting is still required:", imported)

def main():
    a=args_parse()
    root=os.path.abspath(a.project_root) if a.project_root else os.path.abspath(os.path.join(os.path.dirname(__file__),".."))
    project_path=os.path.join(root,"episode-02-engine-project.json")
    if not os.path.isfile(project_path): raise FileNotFoundError("Project data not found; pass --project-root to the extracted episode-02-project directory.")
    ep=json.load(open(project_path,encoding="utf-8"))
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
    sc=bpy.context.scene; sc.name="Episode 01 • skeletal fight"
    sc.frame_start=1; sc.frame_end=600; sc.render.fps=24; sc.render.resolution_x=960; sc.render.resolution_y=540
    sc.render.resolution_percentage=100; sc.render.engine="BLENDER_EEVEE_NEXT"
    sc.world.color=(0,0,0)
    rigc=link_collection("01 Rigs"); colorc=link_collection("02 Colour Parts"); whitec=link_collection("03 Impact Silhouettes"); envc=link_collection("04 Camera + Arena"); inkm=link_collection("05 Impact Ink"); mocap=link_collection("06 Motion Review Only")
    make_background(root,envc)
    impact_ink(inkm)
    for char,spec in ep["characters"].items():
        rig=json.load(open(os.path.join(root,spec["rigFile"]),encoding="utf-8")); ax,ay=rig["root_anchor"]
        arm=make_armature(char,rig,rigc); base=float(rig["base_height"])/float(rig["image_size"][1])
        for pn,part in rig["parts"].items():
            co=make_part(char,rig,pn,part,arm,colorc,root,False); wh=make_part(char,rig,pn,part,arm,whitec,root,True)
            visibility(co,[(1,False),(192,False),(193,False),(194,True),(196,True),(197,False),(600,False)])
            visibility(wh,[(1,True),(192,True),(193,True),(194,False),(196,False),(197,True),(600,True)])
        for sample in ep["boneAnimation"][char]:
            f=int(sample["frame"]); x,bottom,scale,rot,squash,flip=sample["root"]
            arm.location=(x-640,0,360-bottom); sign=-1 if flip else 1
            arm.scale=(base*scale*squash*sign,base*scale,base*scale); arm.rotation_euler=(0,math.radians(rot),0)
            for path in ("location","scale","rotation_euler"): arm.keyframe_insert(data_path=path,frame=f)
            for bn,deg in sample["boneAngles"].items():
                pb=arm.pose.bones.get(bn)
                if pb: pb.rotation_mode="XYZ"; pb.rotation_euler[2]=math.radians(deg); pb.keyframe_insert(data_path="rotation_euler",index=2,frame=f,group=bn)
        if arm.animation_data and arm.animation_data.action:
            try:
                for fc in arm.animation_data.action.fcurves:
                    for kp in fc.keyframe_points: kp.interpolation="LINEAR"
            except Exception: pass
    camera_setup(sc,envc); import_motion(a,mocap); attach_score(sc,root)
    sc.render.image_settings.file_format="PNG"; sc.render.filepath=os.path.join(root,"output","blender-frame-")
    sc.render.image_settings.color_mode="RGBA"; sc.view_settings.view_transform="Standard"
    try: sc.view_settings.look="None"
    except Exception: pass
    sc["impact_contact_frame_blender"]=193; sc["impact_black_white_frames"]="194,195,196"; sc["return_to_colour_frame_blender"]=197
    os.makedirs(os.path.join(root,"output"),exist_ok=True)
    if bpy.data.filepath: pass
    bpy.ops.file.pack_all()
    blend=os.path.join(root,"output","episode-02-skeletal.blend"); bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("Saved:",blend,"; 3 rigs; 15 joints each; 600 frames; 3 impact frames.")
    if a.render:
        sc.render.image_settings.file_format="FFMPEG"; sc.render.ffmpeg.format="MPEG4"; sc.render.ffmpeg.codec="H264"; sc.render.ffmpeg.audio_codec="AAC"
        sc.render.filepath=os.path.join(root,"output","episode-02-blender-render.mp4")
        bpy.ops.render.render(animation=True)

if __name__=="__main__": main()

extends SceneTree
## Lead panorama renderer for the 数码考古馆 project.
## Usage:
##   Godot --path <project> --script res://tools/lead_pano_render.gd -- <scene_path> <out_dir> <res> <wait_frames> <cam_mode> <target_mode>
##   cam_mode:  scene | auto | x,y,z
##   target_mode: scene | auto | x,y,z
## Renders 6 cube faces (90 FOV, axis aligned) + nodes.json with world positions.

var _scene_path := "res://scenes/office_1994_corner.tscn"
var _out_dir := "user://pano"
var _res := 1024
var _wait := 40
var _cam_mode := "scene"
var _target_mode := "scene"
var _vp: SubViewport
var _inst: Node3D
var _scene_cam: Camera3D


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() >= 1: _scene_path = args[0]
	if args.size() >= 2: _out_dir = args[1]
	if args.size() >= 3: _res = int(args[2])
	if args.size() >= 4: _wait = int(args[3])
	if args.size() >= 5: _cam_mode = args[4]
	if args.size() >= 6: _target_mode = args[5]
	_run.call_deferred()


func _parse_vec3(s: String, fallback: Vector3) -> Vector3:
	if s == "auto" or s == "scene" or not s.contains(","):
		return fallback
	var parts := s.split(",")
	if parts.size() != 3:
		return fallback
	return Vector3(float(parts[0]), float(parts[1]), float(parts[2]))


func _run() -> void:
	print("[pano] loading ", _scene_path)
	var packed := load(_scene_path)
	if packed == null:
		push_error("cannot load scene: " + _scene_path)
		quit(2)
		return
	_inst = packed.instantiate()

	_vp = SubViewport.new()
	_vp.size = Vector2i(_res, _res)
	_vp.own_world_3d = true
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	get_root().add_child(_vp)
	_vp.add_child(_inst)

	for i in range(max(2, _wait)):
		await process_frame

	_scene_cam = _find_camera(_inst)
	var bbox: AABB = _bbox(_inst)
	var center: Vector3 = bbox.position + bbox.size * 0.5
	var auto_pos: Vector3 = center + Vector3(bbox.size.x * 0.18, bbox.size.y * 0.22, bbox.size.z * 0.55)
	var auto_target: Vector3 = center

	var pos: Vector3 = _scene_cam.global_position if _scene_cam != null else auto_pos
	var fwd: Vector3 = -_scene_cam.global_basis.z if _scene_cam != null else (auto_target - auto_pos).normalized()
	var target: Vector3 = pos + fwd * 10.0

	pos = _parse_vec3(_cam_mode, pos)
	target = _parse_vec3(_target_mode, target)
	if _cam_mode != "scene":
		fwd = (target - pos).normalized()
	print("[pano] scene=", _scene_path, " cam=", pos, " target=", target, " bbox=", bbox)

	if _scene_cam != null:
		_scene_cam.get_parent().remove_child(_scene_cam)

	var cube := Camera3D.new()
	cube.fov = 90.0
	cube.near = 0.05
	cube.far = 5000.0
	cube.keep_aspect = Camera3D.KEEP_HEIGHT
	_vp.add_child(cube)
	cube.global_position = pos
	await process_frame

	DirAccess.make_dir_recursive_absolute(_out_dir)

	var faces := {
		"px": [Vector3(1, 0, 0), Vector3(0, 1, 0)],
		"nx": [Vector3(-1, 0, 0), Vector3(0, 1, 0)],
		"py": [Vector3(0, 1, 0), Vector3(0, 0, -1)],
		"ny": [Vector3(0, -1, 0), Vector3(0, 0, 1)],
		"pz": [Vector3(0, 0, 1), Vector3(0, 1, 0)],
		"nz": [Vector3(0, 0, -1), Vector3(0, 1, 0)],
	}
	for key in faces.keys():
		var dir: Vector3 = faces[key][0]
		var up: Vector3 = faces[key][1]
		cube.look_at_from_position(pos, pos + dir, up)
		for i in range(3):
			await RenderingServer.frame_post_draw
		var img := _vp.get_texture().get_image()
		var path := _out_dir.path_join("face_%s.png" % key)
		img.save_png(path)
		print("[pano] saved ", path)

	_write_nodes(pos, fwd)
	quit(0)


func _bbox(node: Node) -> AABB:
	var box := AABB()
	var first := true
	for child in node.get_children():
		var b: AABB = _bbox(child)
		if b.size == Vector3.ZERO:
			continue
		if first:
			box = b
			first = false
		else:
			box = box.merge(b)
	if node is VisualInstance3D:
		var vi := node as VisualInstance3D
		var b2: AABB = vi.get_aabb()
		if b2.size != Vector3.ZERO:
			b2.position = vi.global_transform * b2.position
			# approximate: only translate, ignore rotation scaling
			if first:
				box = b2
				first = false
			else:
				box = box.merge(b2)
	return box


func _find_camera(node: Node) -> Camera3D:
	if node is Camera3D:
		return node
	for c in node.get_children():
		var found := _find_camera(c)
		if found != null:
			return found
	return null


func _write_nodes(cam_pos: Vector3, cam_fwd: Vector3) -> void:
	var records: Array = []
	_collect(_inst, records)
	var up := Vector3.UP
	var right := cam_fwd.cross(up).normalized()
	var true_up := right.cross(cam_fwd).normalized()
	var data := {
		"scene": _scene_path,
		"camera_position": [cam_pos.x, cam_pos.y, cam_pos.z],
		"camera_forward": [cam_fwd.x, cam_fwd.y, cam_fwd.z],
		"camera_right": [right.x, right.y, right.z],
		"camera_up": [true_up.x, true_up.y, true_up.z],
		"nodes": records,
	}
	var f := FileAccess.open(_out_dir.path_join("nodes.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify(data, "  "))
	f.close()
	print("[pano] nodes: ", records.size())


func _collect(node: Node, out: Array) -> void:
	if node.name != "" and node is Node3D and node.is_inside_tree():
		var n3 := node as Node3D
		var rec := {
			"name": String(node.name),
			"position": [n3.global_position.x, n3.global_position.y, n3.global_position.z],
		}
		if node is MeshInstance3D:
			rec["mesh"] = true
		out.append(rec)
	for c in node.get_children():
		_collect(c, out)

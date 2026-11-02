# -*- coding: utf-8 -*-
"""Stitch 6 axis-aligned cube faces (90° FOV, rendered by Godot) into an equirectangular panorama.
The pano center (u=0.5,v=0.5) is the render camera's forward direction.
Usage: python stitch_pano.py <scene_dir> <out.jpg> [width]
"""
import sys, os, json, math
import numpy as np
from PIL import Image

SCENE_DIR = sys.argv[1]
OUT = sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 4096
H = W // 2

with open(os.path.join(SCENE_DIR, 'nodes.json'), encoding='utf-8') as f:
    meta = json.load(f)
forward = np.array(meta['camera_forward'], dtype=np.float64)
forward /= np.linalg.norm(forward)
up_world = np.array([0.0, 1.0, 0.0])
right = np.cross(forward, up_world)
right /= np.linalg.norm(right)
up = np.cross(right, forward)
up /= np.linalg.norm(up)

faces = {k: np.asarray(Image.open(os.path.join(SCENE_DIR, f'face_{k}.png')).convert('RGB'), dtype=np.float32) for k in ['px','nx','py','ny','pz','nz']}
face_size = faces['px'].shape[0]

# face directions + up hints (must match Godot render script)
FACE = {
    'px': (np.array([1.,0.,0.]), np.array([0.,1.,0.])),
    'nx': (np.array([-1.,0.,0.]), np.array([0.,1.,0.])),
    'py': (np.array([0.,1.,0.]), np.array([0.,0.,-1.])),
    'ny': (np.array([0.,-1.,0.]), np.array([0.,0.,1.])),
    'pz': (np.array([0.,0.,1.]), np.array([0.,1.,0.])),
    'nz': (np.array([0.,0.,-1.]), np.array([0.,1.,0.])),
}
basis = {}
for k, (d, up_hint) in FACE.items():
    f = d / np.linalg.norm(d)
    z = -f
    x = np.cross(up_hint, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    basis[k] = (f, x, y)

# output grid
yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)
yaw = (xx / W - 0.5) * 2.0 * math.pi
pitch = (0.5 - yy / H) * math.pi
cos_p = np.cos(pitch)
dx = forward[0] * cos_p * np.cos(yaw) + right[0] * cos_p * np.sin(yaw) + up[0] * np.sin(pitch)
dy = forward[1] * cos_p * np.cos(yaw) + right[1] * cos_p * np.sin(yaw) + up[1] * np.sin(pitch)
dz = forward[2] * cos_p * np.cos(yaw) + right[2] * cos_p * np.sin(yaw) + up[2] * np.sin(pitch)
dirs = np.stack([dx, dy, dz], axis=-1)

absd = np.abs(dirs)
axis = np.argmax(absd, axis=-1)
sign = np.take_along_axis(dirs, axis[..., None], axis=-1)[..., 0] > 0
face_idx = axis * 2 + np.where(sign, 0, 1)
mapping = {0: 'px', 1: 'nx', 2: 'py', 3: 'ny', 4: 'pz', 5: 'nz'}

out_img = np.zeros((H, W, 3), dtype=np.float32)
for idx in range(6):
    name = mapping[idx]
    f, x_axis, y_axis = basis[name]
    mask = face_idx == idx
    d = dirs[mask]
    denom = d @ f
    u = (d @ x_axis) / denom
    v = (d @ y_axis) / denom
    px = ((u * 0.5 + 0.5) * (face_size - 1)).clip(0, face_size - 1)
    py = ((0.5 - v * 0.5) * (face_size - 1)).clip(0, face_size - 1)
    x0 = np.floor(px).astype(np.int32); y0 = np.floor(py).astype(np.int32)
    x1 = np.minimum(x0 + 1, face_size - 1); y1 = np.minimum(y0 + 1, face_size - 1)
    fx = (px - x0)[:, None]; fy = (py - y0)[:, None]
    img = faces[name]
    c00 = img[y0, x0]; c10 = img[y0, x1]; c01 = img[y1, x0]; c11 = img[y1, x1]
    out_img[mask] = (c00 * (1 - fx) * (1 - fy) + c10 * fx * (1 - fy) + c01 * (1 - fx) * fy + c11 * fx * fy)

res = np.clip(out_img, 0, 255).astype(np.uint8)
Image.fromarray(res).save(OUT, quality=90, optimize=True, progressive=True)
print('saved', OUT, W, 'x', H, os.path.getsize(OUT) // 1024, 'KB')

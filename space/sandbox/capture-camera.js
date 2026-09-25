// Camera meshes use local +Z as their optical axis.
export function aimCaptureCamera(head, target) {
 head.lookAt(target);
}

export function createCaptureCamera(THREE, { position, target, color }) {
 const group = new THREE.Group(); group.position.copy(position);
 const head = new THREE.Group(); head.name = 'capture-optical-head'; group.add(head);
 const black = new THREE.MeshStandardMaterial({ color: 0x202326, roughness: .62, metalness: .25 });
 const rubber = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: .94 });
 const alloy = new THREE.MeshStandardMaterial({ color: 0x7f8589, roughness: .32, metalness: .85 });
 const glass = new THREE.MeshPhysicalMaterial({ color: 0x122e36, roughness: .12, metalness: .45, clearcoat: 1 });
 const accent = new THREE.MeshStandardMaterial({ color, roughness: .55 });
 function box(parent, size, xyz, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...xyz); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
 }
 function rod(parent, a, b, radius, material) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material);
  mesh.position.copy(from).add(to).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true; parent.add(mesh); return mesh;
 }
 // A compact video camera: rounded magnesium shell, grip, display and lens barrel.
 const shape = new THREE.Shape();
 const w = .25, h = .15, r = .022;
 shape.moveTo(-w / 2 + r, -h / 2); shape.lineTo(w / 2 - r, -h / 2);
 shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
 shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
 shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
 shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
 const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .105, bevelEnabled: true, bevelSize: .004, bevelThickness: .004, bevelSegments: 2, steps: 1 }), black);
 shell.position.z = -.11; shell.castShadow = shell.receiveShadow = true; head.add(shell);
 box(head, [.062, .135, .12], [-.105, -.005, -.032], rubber);
 box(head, [.055, .035, .055], [.025, .091, -.065], black);
 box(head, [.137, .09, .008], [.015, -.006, -.12], alloy);
 box(head, [.125, .079, .009], [.015, -.006, -.126], new THREE.MeshStandardMaterial({color:0x18343b,roughness:.24,metalness:.25}));
 for (const x of [-.08, .07]) rod(head, [x, .079, -.05], [x, .14, -.05], .009, black);
 rod(head, [-.08, .14, -.05], [.07, .14, -.05], .012, rubber);
 for (const [z, radius, length, material] of [[.015,.063,.04,black],[.05,.067,.026,rubber],[.08,.061,.033,black],[.106,.065,.015,alloy],[.118,.062,.012,rubber]]) {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 32), material);
  ring.rotation.x = Math.PI / 2; ring.position.z = z; ring.castShadow = true; head.add(ring);
 }
 const lens = new THREE.Mesh(new THREE.CircleGeometry(.052, 32), glass); lens.position.z = .125; lens.name = 'capture-lens'; head.add(lens);
 box(head, [.034, .008, .004], [.077, .035, .006], accent);
 // Quick-release plate and fluid head; the tripod stays vertical while the camera tilts.
 box(group, [.17, .022, .105], [0, -.097, -.02], alloy);
 rod(group, [0, -.27, 0], [0, -.12, 0], .038, black);
 rod(head, [.095, -.1, -.03], [.2, -.16, -.33], .008, alloy);
 rod(head, [.2, -.16, -.33], [.23, -.18, -.42], .012, rubber);
 const groundY = -position.y + .025;
 for (let i = 0; i < 3; i++) {
  const a = i * Math.PI * 2 / 3 + Math.PI / 6;
  const foot = [Math.cos(a) * .38, groundY, Math.sin(a) * .38];
  const top = [Math.cos(a) * .045, -.24, Math.sin(a) * .045];
  const mid = top.map((value, axis) => value * .46 + foot[axis] * .54);
  rod(group, top, mid, .015, black); rod(group, mid, foot, .009, alloy);
  box(group, [.035, .04, .035], mid, rubber);
  box(group, [.055, .025, .075], foot, rubber);
  rod(group, [0, groundY * .63, 0], top.map((value, axis) => value * .32 + foot[axis] * .68), .006, alloy);
 }
 const ring = new THREE.Mesh(new THREE.RingGeometry(.43, .445, 64), new THREE.MeshBasicMaterial({color,transparent:true,opacity:.45,side:THREE.DoubleSide}));
 ring.rotation.x = -Math.PI / 2; ring.position.y = groundY; group.add(ring);
 aimCaptureCamera(head, target);
 return { group, head, lens };
}

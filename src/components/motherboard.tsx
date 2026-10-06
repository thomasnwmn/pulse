"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Box, RotateCcw } from "lucide-react";
import { componentLoad, componentNames, type ComponentId, type Telemetry } from "@/lib/telemetry";

type SceneHandle = { reset: () => void; components: Record<ComponentId, { material: THREE.MeshStandardMaterial; light: THREE.PointLight }>; selection: Record<ComponentId, THREE.Mesh> };
const ids: ComponentId[] = ["cpu", "memory", "gpu", "storage"];

export default function Motherboard({ data, selected, onSelect }: { data: Telemetry | null; selected: ComponentId; onSelect: (id: ComponentId) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const labels = useRef<Partial<Record<ComponentId, HTMLButtonElement>>>({});
  const tooltip = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const onSelectRef = useRef(onSelect);
  const dataRef = useRef(data);
  const [error, setError] = useState(false);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    const host = container.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    catch { const frame = requestAnimationFrame(() => setError(true)); return () => cancelAnimationFrame(frame); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .08;
    controls.minDistance = 7; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI / 2.15; controls.enablePan = false;
    const reset = () => { const damping = controls.enableDamping; controls.enableDamping = false; controls.update(); camera.position.set(7.8, 10.8, 10.2); controls.target.set(0, .3, 0); controls.update(); controls.enableDamping = damping; };
    reset();
    scene.add(new THREE.HemisphereLight(0xf2ffe3, 0x74836b, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(-5, 12, 7); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
    sun.shadow.normalBias = .04;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xe5efce, 1.5); rim.position.set(6, 4, -5); scene.add(rim);
    const board = new THREE.Group(); scene.add(board);
    const matte = (color: THREE.ColorRepresentation, metalness = .15) => new THREE.MeshStandardMaterial({ color, roughness: .65, metalness });
    const pcb = matte(0x404d37), dark = matte(0x2f342e), metal = matte(0x8b9688, .75), black = matte(0x222822), silver = matte(0xabb3a5, .7), gold = matte(0xb9a779, .65);
    function box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, group = board) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
    }
    function cylinder(r: number, h: number, x: number, y: number, z: number, material: THREE.Material, group = board) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), material); mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh;
    }
    box(7.2, .18, 8.2, 0, 0, 0, pcb);
    // The model is procedural: no remote assets or textures are fetched.
    const traceMaterial = new THREE.LineBasicMaterial({ color: 0x809467, transparent: true, opacity: .3 });
    for (let i = 0; i < 35; i++) {
      const z = -3.5 + i * .205;
      const points = [new THREE.Vector3(-3.1, .098, z), new THREE.Vector3(-1.2 + i % 7 * .22, .098, z), new THREE.Vector3(-.8 + i % 7 * .22, .098, z + .4), new THREE.Vector3(3.1, .098, z + .4)];
      board.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), traceMaterial));
    }
    for (const x of [-3.25, 3.25]) for (const z of [-3.75, 3.75]) { cylinder(.12, .04, x, .12, z, silver); cylinder(.05, .045, x, .13, z, dark); }
    // Rear I/O ports and power circuitry.
    for (let i = 0; i < 5; i++) { box(.63, .5 + (i % 2) * .15, .65, -3.15, .35, -2.65 + i * .8, metal); box(.04, .22, .34, -3.48, .35, -2.65 + i * .8, black); }
    box(.56, .65, 2.7, -2.5, .4, -1.6, dark);
    for (let i = 0; i < 13; i++) box(.6, .07, .1, -2.5, .75, -2.8 + i * .19, metal);
    box(2.3, .42, .65, -.9, .31, -3.3, dark);
    for (let i = 0; i < 12; i++) box(.09, .12, .67, -1.93 + i * .18, .57, -3.3, metal);
    for (let i = 0; i < 9; i++) cylinder(.095, .3, -2.05, .3, -2.7 + i * .4, silver);
    box(.27, .26, 2.25, 3.21, .23, -1.75, black);
    for (let i = 0; i < 12; i++) box(.08, .03, .07, 3.21, .38, -2.75 + i * .18, gold);
    const components = {} as SceneHandle["components"];
    const selection = {} as SceneHandle["selection"];
    const hitTargets: THREE.Object3D[] = [];
    const centers: Record<ComponentId, THREE.Vector3> = { cpu: new THREE.Vector3(-.9, 1, -1.5), memory: new THREE.Vector3(1.9, 1.6, -1.4), gpu: new THREE.Vector3(-.1, 1.3, 1.5), storage: new THREE.Vector3(1.95, .4, 3) };
    const labelCenters: Record<ComponentId, THREE.Vector3> = { cpu: new THREE.Vector3(-1.75, 1.8, -2.6), memory: new THREE.Vector3(2.35, 2.2, -2), gpu: new THREE.Vector3(-1.3, 2.1, 2.2), storage: new THREE.Vector3(2.2, .8, 3.5) };
    function component(id: ComponentId, width: number, depth: number) {
      const group = new THREE.Group(); board.add(group); group.userData.component = id;
      const material = matte(0x8ca064, .45); material.emissive.set(0x83a641); material.emissiveIntensity = .15;
      const light = new THREE.PointLight(0x83a641, .2, 4); light.position.copy(centers[id]); group.add(light);
      const outline = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ color: 0xbbde85, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }));
      outline.rotation.x = -Math.PI / 2; outline.position.set(centers[id].x, .108, centers[id].z); group.add(outline);
      selection[id] = outline; components[id] = { material, light };
      return { group, material };
    }
    const cpu = component("cpu", 2.5, 2.3);
    box(1.9, .1, 1.9, -.9, .2, -1.5, black, cpu.group);
    box(1.45, .19, 1.45, -.9, .35, -1.5, cpu.material, cpu.group);
    box(1.1, .1, 1.1, -.9, .5, -1.5, cpu.material, cpu.group);
    for (let i = 0; i < 4; i++) box(1.25, .05, .045, -.9, .557, -1.85 + i * .23, cpu.material, cpu.group);
    const memory = component("memory", 1.9, 3.6);
    for (let i = 0; i < 4; i++) {
      const x = 1.15 + i * .43;
      box(.17, .18, 3, x, .22, -1.2, dark, memory.group);
      box(.1, 1.05, 2.6, x, .7, -1.2, memory.material, memory.group);
      box(.15, .12, 2.8, x, 1.28, -1.2, memory.material, memory.group);
      for (let j = 0; j < 6; j++) box(.15, .32, .26, x, .75, -2.28 + j * .43, black, memory.group);
      for (const z of [-2.75, .35]) box(.25, .2, .13, x, .27, z, silver, memory.group);
    }
    // Graphics card with two actual 3D fans.
    const gpu = component("gpu", 5.2, 1.55);
    box(4.9, .16, .19, -.2, .22, 1.35, dark, gpu.group);
    box(4.9, 1.03, .12, -.2, .77, 1.35, gpu.material, gpu.group);
    box(4.65, 1, .57, -.2, .82, 1.65, dark, gpu.group);
    box(4.6, .08, .61, -.2, 1.35, 1.65, gpu.material, gpu.group);
    for (const x of [-1.35, .9]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.38, .035, 8, 32), metal); ring.position.set(x, .83, 1.96); gpu.group.add(ring);
      const fan = new THREE.Group(); fan.position.set(x, .83, 1.98); gpu.group.add(fan);
      for (let j = 0; j < 9; j++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(.11, .29, .025), silver); const angle = j / 9 * Math.PI * 2; blade.position.set(Math.sin(angle) * .19, Math.cos(angle) * .19, 0); blade.rotation.z = -angle + .4; fan.add(blade); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(.085, .085, .035, 16), black); hub.rotation.x = Math.PI / 2; fan.add(hub);
    }
    const storage = component("storage", 2.1, .9);
    box(1.9, .1, .65, 1.9, .2, 2.95, dark, storage.group);
    box(1.75, .18, .68, 1.9, .33, 2.95, storage.material, storage.group);
    for (let i = 0; i < 9; i++) box(.07, .05, .72, 1.15 + i * .18, .45, 2.95, i % 2 ? metal : storage.material, storage.group);
    cylinder(.055, .025, 2.8, .46, 2.95, silver, storage.group);
    // Additional chipset, expansion slots, headers, and coin battery.
    box(1.1, .22, .92, -.95, .22, 3.0, dark);
    for (let i = 0; i < 6; i++) box(.09, .1, .97, -1.4 + i * .18, .37, 3.0, metal);
    for (const z of [.45, 2.43, 3.57]) box(2.7, .13, .12, -1.6, .19, z, black);
    cylinder(.28, .08, -2.8, .22, 3.0, silver);
    for (let i = 0; i < 13; i++) { box(.13, .1, .19, -3 + i * .45, .18, 3.9, dark); box(.04, .13, .04, -3 + i * .45, .28, 3.9, gold); }
    for (let i = 0; i < 18; i++) { const x = -2.8 + (i % 6) * .53; const z = .08 + Math.floor(i / 6) * .16; box(.22, .05, .07, x, .15, z, silver); }
    ids.forEach(id => { const group = selection[id].parent!; group.traverse(object => { object.userData.component = id; if (object instanceof THREE.Mesh && object !== selection[id]) hitTargets.push(object); }); });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .12 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.13; floor.receiveShadow = true; scene.add(floor);
    sceneRef.current = { components, selection, reset };
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hover: ComponentId | null = null;
    let downX = 0, downY = 0;
    const pick = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      return ray.intersectObjects(hitTargets, false)[0]?.object.userData.component as ComponentId | undefined;
    };
    const move = (event: PointerEvent) => {
      hover = pick(event) ?? null;
      renderer.domElement.style.cursor = hover ? "pointer" : "grab";
      if (tooltip.current) { const bounds = host.getBoundingClientRect(); const load = hover && dataRef.current ? componentLoad(dataRef.current, hover) : null; tooltip.current.hidden = !hover; tooltip.current.textContent = hover ? `${componentNames[hover]} · ${load === null ? "Sensor unavailable" : `${load.toFixed(0)}% usage`}` : ""; tooltip.current.style.left = `${Math.max(5, Math.min(event.clientX - bounds.left + 12, bounds.width - 165))}px`; tooltip.current.style.top = `${Math.max(5, event.clientY - bounds.top - 30)}px`; }
    };
    const down = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; };
    const up = (event: PointerEvent) => { if (Math.hypot(event.clientX - downX, event.clientY - downY) < 5) { const id = pick(event); if (id) onSelectRef.current(id); } };
    const leave = () => { hover = null; if (tooltip.current) tooltip.current.hidden = true; };
    const lostContext = (event: Event) => { event.preventDefault(); setError(true); };
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointerleave", leave);
    renderer.domElement.addEventListener("webglcontextlost", lostContext);
    const resize = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); resize.observe(host);
    let frame = 0, previous = 0;
    let visible = true;
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }); observer.observe(host);
    const projected = new THREE.Vector3();
    function animate(time: number) {
      frame = requestAnimationFrame(animate);
      if (!visible || document.hidden || time - previous < 1000 / 30) return;
      previous = time;
      controls.update(); renderer.render(scene, camera);
      ids.forEach(id => { const label = labels.current[id]; if (!label) return; projected.copy(labelCenters[id]).project(camera); label.style.left = `${(projected.x * .5 + .5) * host.clientWidth}px`; label.style.top = `${(-projected.y * .5 + .5) * host.clientHeight}px`; label.style.visibility = projected.z < 1 ? "visible" : "hidden"; });
    }
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointermove", move); renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointerup", up); renderer.domElement.removeEventListener("pointerleave", leave); renderer.domElement.removeEventListener("webglcontextlost", lostContext);
      const materials = new Set<THREE.Material>();
      scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m)); } });
      materials.forEach(m => m.dispose()); renderer.dispose(); renderer.domElement.remove(); sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    ids.forEach(id => {
      const load = data ? componentLoad(data, id) : null;
      const amount = Math.min(100, load ?? 0) / 100;
      const color = new THREE.Color().setHSL(.24 * (1 - amount), .8, .32);
      const { material, light } = handle.components[id];
      material.color.copy(load === null ? new THREE.Color(0x89917f) : color);
      material.emissive.copy(color); material.emissiveIntensity = load === null ? 0 : .12 + amount * 1.8;
      light.color.copy(color); light.intensity = load === null ? 0 : .2 + amount * 3;
      (handle.selection[id].material as THREE.MeshBasicMaterial).opacity = id === selected ? .35 : .03;
    });
  }, [data, selected]);

  return <div className="motherboard-scene" ref={container} aria-label="Interactive 3D motherboard">
    {!error && <>{ids.map(id => <button key={id} ref={element => { labels.current[id] = element ?? undefined; }} className={`scene-label ${selected === id ? "selected" : ""}`} onClick={() => onSelect(id)} aria-pressed={selected === id}>{id === "memory" ? "RAM" : id === "storage" ? "NVMe" : id.toUpperCase()}<strong>{data && componentLoad(data, id) !== null ? `${componentLoad(data, id)!.toFixed(0)}%` : "—"}</strong></button>)}<button className="scene-reset" onClick={() => sceneRef.current?.reset()}><RotateCcw size={12} /> Reset view</button><div hidden className="scene-hover" ref={tooltip} /></>}
    {error && <div className="scene-error"><Box size={35} /><p>3D rendering requires WebGL 2.<br />You can still inspect each component below, or switch to the 2D view.</p><div className="fallback-buttons">{ids.map(id => <button key={id} className="button" onClick={() => onSelect(id)}>{componentNames[id]}</button>)}</div></div>}
  </div>;
}

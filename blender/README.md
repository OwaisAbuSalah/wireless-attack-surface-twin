# Blender digital twin — scene builder and Cycles renders

`blender/build_twin.py` builds the faculty building, its site and the baseline Wi-Fi leak map
**procedurally from `data/building.json`** (the single source of truth shared with `web/` and
`sim/`), then renders the presentation figures with Cycles. It has no add-ons, no external
textures and no manual steps: every run clears the scene and rebuilds it from scratch.

| Figure | What it shows |
|---|---|
| `docs/figures/blender_hero.png` | 3/4 aerial over University Street at blue hour. The baseline outdoor RSS map is draped over every ground surface (turbo colormap, −100…−30 dBm, faint 5 dB iso-lines). The **eavesdropping danger contour** (RSS + 5 dBi ≥ −92 dBm, USB kit) is drawn as a glowing `#ff2d55` line. The attacker sits on the café terrace inside a red ring at `attack.start`. |
| `docs/figures/blender_cutaway.png` | Floor 2 and the roof are removed and floor 1 is cut at 1.6 m (section tops in charcoal poché). The floor-1 RSS map (z = 4.8 m) lies on the floor slab. The access point has a blue pin and halo and sits on a translucent "ghost" of the removed wall pier. Each client has a cyan pin and floor rings. The outdoor map and contour continue around the building. |
| `docs/figures/blender_street.png` | Eye-level over-the-shoulder shot from the café terrace: the hooded attacker, his laptop (glowing terminal and 5 dBi USB whip), and the building across the street. The leak overlay is on the street: green/yellow on the carriageway, a red band at the façade. |
| `docs/figures/blender_clean.png` | Clean daylight architectural render without any overlay. |

## Run

```bat
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup ^
    -P blender/build_twin.py -- --out docs/figures --samples 256
```

(run from the project root; paths are resolved relative to it). It renders the four views, saves
`blender/out/twin.blend` and exports `blender/out/twin.glb`.

| Option (after `--`) | Default | Meaning |
|---|---|---|
| `--out DIR` | `docs/figures` | where the PNGs go |
| `--samples N` | `256` | Cycles samples (adaptive, OIDN-denoised on the GPU) |
| `--views LIST` | `hero,cutaway,street,clean` | any subset; debug close-ups: `figure`, `figure_front`, `router` |
| `--res WxH` | `1920x1080` | output size |
| `--percent P` | `100` | resolution % (e.g. `50` for previews) |
| `--cell M` | `0.25` | outdoor RSS grid cell. `0.5` is the spec grid (`rf.grids.outdoor`, 112 k cells). The renders use 0.25 (448 k cells): same model, finer sampling, so the contour along the sharp window-beam edges is smooth instead of stair-stepped |
| `--floor-cell M` | `0.1` | floor-1 RSS grid cell |
| `--suffix S` | | appended to the PNG names (`blender_hero_preview.png`) |
| `--device` | `OPTIX` | `OPTIX`, `CUDA` or `CPU` |
| `--no-render`, `--no-blend`, `--no-glb` | | skip a stage |
| `--set T.S.K=V` | | override a preset value without editing the file: `--set light.dusk.exposure=0.8`, `--set cam.hero.lens=28`, `--set view.street.opacity=0.4` |

Quick preview (≈ 1 min for all four views):

```bat
blender -b --factory-startup -P blender/build_twin.py -- --out docs/figures/preview --percent 50 --samples 32 --suffix _p --no-blend --no-glb
```

Build only (≈ 10 s; for opening the `.blend` and looking around):
`... -P blender/build_twin.py -- --no-render`

## Outputs

| File | Content |
|---|---|
| `docs/figures/blender_{hero,cutaway,street,clean}.png` | 1920×1080 renders |
| `blender/out/twin.blend` | the full scene (left in the *hero* state). The RSS field images are packed. All four cameras are `CAM_*`, and each view's settings are re-applied by `apply_view()` |
| `blender/out/twin.glb` | building + site + context buildings + street furniture, **no heat map, no RF markers, no lights** (205 meshes, 81 k polygons, 2.6 MB, no modifiers applied). glTF is Y-up: glTF `x` = east, `y` = up, `z` = −north. The ground slab and the roads and sidewalks that touch the edge of the study area extend to ±1.6 km, so they reach the horizon |
| `blender/out/rss_outdoor.exr`, `rss_floor1.exr` | float maps: R = RSS (dBm), G = signed distance (m) to the eavesdropping contour (positive = danger side), B = distance (m) to the nearest 5 dB iso-level. Row 0 = southern edge (`y0`), as in MODEL.md §4 |
| `blender/out/render_log.json` | arguments, RF statistics, per-view render times, automated checks |

## Render times

RTX 3060 12 GB, OptiX, 256 samples (adaptive), OIDN denoise, 1920×1080:

| Step | Time |
|---|---|
| RSS maps (outdoor 800×560 @ 0.25 m + floor 1 370×170 @ 0.1 m) | 6 s |
| Scene build (563 objects) | < 1 s |
| `blender_hero.png` | 83 s |
| `blender_cutaway.png` | 82 s |
| `blender_street.png` | 126 s |
| `blender_clean.png` | 70 s |
| **Whole run** (4 renders + `.blend` + `.glb`) | **6 min 8 s** |

The 50 % / 32-sample preview runs all four views in about 1 minute.

## How it is built

**Modules** (all in `blender/`):

| Module | Role |
|---|---|
| `build_twin.py` | CLI, materials, scene assembly, lighting presets, cameras, compositor, views, `.blend`/`.glb` |
| `twin_rf.py` | the propagation model (pure NumPy, no `bpy`). `python blender/twin_rf.py` prints map statistics |
| `twin_mesh.py` | `MeshBuilder`: merges thousands of primitives into a few objects and builds manifold "grid solids" (walls with holes, slabs with voids) |
| `twin_building.py` | walls, openings, windows, curtain wall, doors, slabs, stairs, roof, furniture |
| `twin_site.py` | ground, roads, markings, curbs, plaza, lawns, parking, terrace, context massing, backdrop |
| `twin_props.py` | trees, cars, lamps, café sets, string lights, attacker, access point, client devices |
| `twin_mats.py` | procedural materials (no UVs) and the heat-map overlay node group |

**Building.** Each wall in `walls` is a **manifold solid with its openings cut by construction**.
The wall elevation is split into a cell grid at every opening edge (the openings come from
`opening{sill, head, period, width, offset}` with the same interval maths as MODEL.md §2.1). Cells
inside an opening are left empty, and the result is extruded to the wall's thickness `t`. The
method uses no booleans, and the angle-limited Bevel modifier rounds only the real edges. The ends
of each wall are adjusted at junctions: L-corners are extended into each other and T-junctions
are tucked into the host wall, so corners close without coplanar faces. Wall pieces stop under
the slabs: slab *k* occupies [z_k − 0.3, z_k] and its edge band projects 4 cm out of the façade.

* `ext_glass` openings become framed double glazing with a centre mullion (two for 2.4 m windows
  and a transom in the tall corridor windows) and a stone sill. The glass passes shadow rays
  straight through, so interiors are lit and never render black.
* The lobby wall (period 1.5 m, 92 % glass) is recognised as a **curtain wall**. It is drawn as
  0.16 m aluminium mullions flush with the façade, with the two central bays as glazed entrance
  doors (transom and push bars).
* `wood` and `metal` openings get a door leaf (a double leaf if ≥ 1.4 m wide), casing and handles.
  `air` stays open (the stair entry), and the `glass` partition becomes a framed full-height
  glazed wall.
* There is a stair/lift core with switchback stairs (stair voids in the slabs above) and a roof
  with a parapet, coping, a stair/lift bulkhead, HVAC units and a small PV array. A light entrance
  canopy sits over the lobby.
* Furnishing hints are chosen per room `type`: desks and monitors, lab benches, lecture rows, a
  meeting table, classroom desks, a lobby reception and sofas, cafeteria tables, workbenches,
  shelving, wc partitions, a printer, a kitchen counter. The server room has two rows of racks
  with LED fronts. Each room has a warm area light and visible ceiling panels.

**Site.** Ground layers are staggered by millimetres so no two surfaces are coplanar. From top to
bottom: terrace deck +6 cm, walkway, plaza, sidewalks 0, lawns −2 cm, ground −4 cm, parking
−12 cm, roads −14 cm. Sidewalk edges along the roads get curb stones. The roads have double
yellow centre lines, edge and parking-lane lines, a zebra crossing between the entrance and the
café, and a dashed side-street centre line. The parking lot has stall lines from `parking.rows`.
The listed `cars` are placed on their surface (one shared low-poly mesh, colour per object). The
four `traffic` cars drive with their headlights on at dusk. Low-poly trees are sized from `s`,
street, parking and bollard lamps have emissive heads and spot lights, and the café tables have
umbrellas (open by day, closed at dusk), planters and string lights. Context buildings are
massing models with procedural window grids (randomly lit at dusk), street-facing shop fronts,
library fins and housing balconies. Roads that touch the edge of the study area continue to the
horizon, and a low-detail backdrop city fades into a mist pass.

**RF elements.** The access point is a white AP on a wall shelf at `router.mounts.wall.pos`, with
three dipoles and a blue LED. The `clients` are devices on desks (laptop, tablet, phone, desktop,
printer) with a cyan pin above each. The attacker at `attack.start` is a stylised seated hooded
figure: a subdivided mannequin with a laptop and a USB whip.

### Heat-map overlay (MODEL.md §2–4)

`twin_rf.py` implements the baseline in NumPy:

* `PL = 20·log10(f) + 32.44 + 10·n·log10(max(d, 0.5)) + ΣL_wall + ΣL_slab`, with n = 2 and f = 2.4 GHz.
* **3-D wall crossings**: plan intersection with 0 < t < 1 and 0 ≤ u ≤ 1, the height test
  z0 ≤ zc ≤ z1, and the opening test with a positive modulo. All 165 walls are used, including the
  context façades.
* **Slab planes** strictly between the transmitter and the receiver, inside `slab_extent`.
* **Vertical half-wave dipole**: `G = 2.15 + 10·log10(max(F², 10⁻³))`.
* `RSS = 20 dBm + G_tx − PL`, using the wall mount.

The computation is vectorised over (cells × walls) in chunks of 6 000 cells. The 0.25 m grid (448 k
cells) takes about 6 s and the 0.5 m spec grid about 3 s. Results at 0.5 m: outdoor RSS ranges
from −150.8 to −40.6 dBm (median −84.3). **22 522 m² (82 %) of the study area** outside the
footprint allows eavesdropping with the USB kit. Floor 1 at z = 4.8 m ranges from −117 to −25 dBm.

The map is stored as a float image and draped in the shader: a node group samples it at the
world XY of every ground material (roads, sidewalks, curbs, plaza, lawns, deck, markings). It
therefore follows curbs and steps exactly, with no floating plane and no z-fighting.

* The turbo colour (a 32-stop ColorRamp of the turbo polynomial) is emitted.
* The emission is modulated by the surface albedo, so lane markings, the zebra crossing and paving
  joints stay readable under the map, like projected light.
* The colour fades out below −100 dBm and over the last 7 m of the study area.
* The **danger contour** is drawn from the signed-distance channel as a crisp line of constant
  width in metres, with a soft glow on the dangerous side. The bloom comes from the compositor's
  Glare node.
* Floor 1 uses the same group with its own 0.1 m map, masked to the building interior.

## Lighting and render settings

* **Blue hour** (hero, cutaway, street): multiple-scattering sky with the sun 3° below the horizon
  in the WNW. Warm room lights, warm street and parking lamps, terrace string lights, grazing
  uplights on the street-façade piers, car headlights, lit context windows. AgX "Punchy", exposure +1.
* **Daylight** (clean): the same sky with the sun 33° high in the SW. All artificial lights off,
  umbrellas open. AgX "Medium High Contrast", exposure −3.75.
* Cycles on OptiX with the light tree, adaptive sampling (0.012) and OIDN denoising on the GPU.
  Bounces: 8 total, 3 diffuse/glossy, 8 transmission, 24 transparent. Caustics are off and
  indirect light is clamped at 6.
* Compositor (Blender 5 node-group compositor): mist blend toward the horizon colour, bloom
  (Glare › Bloom) for the dusk views, and a soft vignette.
* `check_scene()` verifies that every car, lamp and tree stands exactly on its surface, that no
  vertex is NaN, and that the AP lies inside the footprint. The result is written to the log.

## Deliberate departures / notes

* **Visual-only thicknesses**: the curtain wall is drawn 0.16 m deep (data `t` = 0.3 is the
  concrete it sits in) and the 3 mm steel lift-shaft sheets 5 cm thick. The RF model uses the data
  unchanged (walls are centre planes there anyway).
* **Visual extras that are not in the RF model**: the entrance canopy, roof plant and PV, interior
  furniture, string lights, uplights, the traffic cars and the backdrop city.
* **Per-view decluttering**:
  * Cutaway: trees within 11 m of the footprint are hidden, so the floor plan reads.
  * Street: the closed umbrella of the attacker's own table is hidden, because it would stand in
    front of the façade.
  * Cutaway: floor 1's stairs are hidden; the ground-floor stairs stay visible through the void.
* **Cutaway**: the access point is mounted at 2.2 m above floor 1, above the 1.6 m section. The
  wall pier it hangs on is therefore drawn as a translucent ghost
  (`twin_building.GHOST_ROUTER_PIER`). `KEEP_ROUTER_PIER = True` keeps it solid instead.
* The floor-1 map has no danger contour, because MODEL.md defines the danger zone on outdoor
  cells only. It shows faint 5 dB iso-lines instead.
* Every number that shapes the look is a constant at the top of `build_twin.py` (`CAMERAS`,
  `VIEWS`, `LIGHTING`, `HEAT_RANGE`, `ISO_STEP`, …) or of the modules.
* Blender 5.x gotchas handled here:
  * Changing the colourspace of a generated image regenerates its buffer, so the colourspace is
    set before the pixels are written.
  * The compositor is a node group in `scene.compositing_node_group`, and the Glare options are
    input sockets.
  * Sky `sun_rotation` = 0 points the sun at +Y. The math azimuth `az` therefore maps to
    `rotation = 90° − az`.

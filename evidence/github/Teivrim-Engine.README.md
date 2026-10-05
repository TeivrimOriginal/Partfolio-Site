ДОКАЗАТЕЛЬСТВО. Не выдумывать содержимое этого файла.
Источник: https://github.com/TeivrimOriginal/Teivrim-Engine/blob/main/README.md
Что сверялось: движок: Vulkan и OpenGL, scene graph, Assimp, FBX и OBJ
Снято: 2026-10-05
Символов: 8573
# Teivrim Engine

A cross-platform game engine written from scratch in C++17 with a dual OpenGL / Vulkan rendering backend.

> **Status: early development (~15%).** Written and maintained solo as a learning project. The architecture is designed and documented; the implementation is partial and the API will change.

[![Language: C++](https://img.shields.io/badge/C%2B%2B-17-00599C?logo=cplusplus&logoColor=white)](https://isocpp.org/)
[![Build: CMake](https://img.shields.io/badge/build-CMake-064F8C?logo=cmake&logoColor=white)](https://cmake.org/)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D7?logo=windows&logoColor=white)](https://learn.microsoft.com/en-us/windows/)
[![CI](https://github.com/TeivrimOriginal/Teivrim-Engine/actions/workflows/ci.yml/badge.svg)](https://github.com/TeivrimOriginal/Teivrim-Engine/actions/workflows/ci.yml)

---

## Why this project exists

Most engine code on GitHub is either a thin wrapper over SDL/bgfx, or abandoned. This one is a deliberate exercise in understanding what actually happens between `main()` and a pixel on screen: window creation, swapchains, shader compilation, model import, scene graph traversal, and UI batching.

It is also the reason I moved from Python/PHP to C++.

## Architecture

```
                        PublicAPI.h  (static facade / embedding surface)
                    ┌──────────────────┼──────────────────┐
              WindowAPI            ObjectAPI           CameraAPI
                    │                  │                  │
   ┌────────────────┴──────────────────┴──────────────────┴───────────────┐
   │                            Core                                  │
   │  GameLoop · config · asset + icon managers · public API surface    │
   └───────┬──────────────────────────────────────────┬─────────────────┘
           │                                          │
   ┌───────┴──────────┐                    ┌──────────┴──────────────────┐
   │  SecondComplexity│                    │            Render            │
   │  SceneManager    │◄──────────────────►│  AbstractRender (singleton) │
   │  ObjectScene     │  models / matrices │  RenderAPIType::OPENGL      │
   │  ProjectManager  │                    │            ::VULKAN        │
   │  AssetManager    │                    └──────────┬──────────────────┘
   │  IconManager     │                               │
   └──────────────────┘            ┌─────────────────┴─────────────────┐
                                   │                                   │
                     ┌─────────────┴──────┐            ┌───────────────┴──────────┐
                     │  OpenGL backend    │            │     Vulkan backend      │
                     │  GLEW + GLFW       │            │  device, swapchain,     │
                     │  rendererw.cpp     │            │  render pass, SPIR-V    │
                     └────────────────────┘            │  (Vulkan.cpp, 2nd pass) │
                                                        └──────────────────────────┘

   ┌─────────────────────────────  Support  ──────────────────────────────┐
   │  InterfaceManager · Panels · ObjectUI · BufferLayer · font atlases   │
   │  ModelParser (Assimp: FBX/OBJ/MTL) · stb_truetype · stb_image       │
   │  Camera · Input · InitialWin32 (window platform abstraction)         │
   └──────────────────────────────────────────────────────────────────────┘
```

## Design decisions

**Backend is chosen at runtime, not at compile time.** `AbstractRender` is a singleton initialised with a `RenderAPIType` enum, so the same scene code drives either backend. `GetDevice()` / `GetRenderPass()` expose the native handles that only the Vulkan path has.

**Transforms use quaternions, not Euler angles.** `SceneObject::Transform` stores `glm::quat` and converts to/from Euler for the inspector, which avoids gimbal lock and interpolation artifacts.

**The scene is a real graph.** Objects carry `parentID` and `childrenIDs`; world matrices are composed from the hierarchy, not stored flat.

**UI and 3D share one draw layer.** `DrawText`, `DrawImage`, `DrawImageUV` and `DrawQuad` live on the same `AbstractRender` surface as `RenderModel`, so the editor UI is rendered by the engine itself rather than bolted on.

**A static facade for embedding.** `PublicAPI.h` exposes `WindowAPI` / `ObjectAPI` / `CameraAPI` as flat static classes. The intent is a stable, scripting-friendly surface over the internal engine, so gameplay code never touches renderer internals.

**Shaders are precompiled to SPIR-V.** GLSL sources are committed next to the `.spv` artifacts they produce, and the Vulkan path was debugged with the standard Khronos validation layers.

## Implemented

| Area | State |
|------|-------|
| OpenGL renderer (GLEW, instanced quads, text, textures) | Working |
| Vulkan renderer (device, swapchain, render pass, SPIR-V) | In progress |
| Scene graph with parent/child hierarchy, quaternions | Working |
| Model import via Assimp (FBX, OBJ, MTL) | Working |
| Text rendering with stb_truetype + prebaked font atlases (16/32/64/128) | Working |
| Editor UI (panels, inspector, object list) from JSON definitions | Partial |
| JSON-driven project files (`project.json`, `meta.json`) | Working |
| Public facade API | Draft |
| Cross-platform windowing beyond Win32 | Not started |

## Building

Requires a C++17 compiler, CMake ≥ 3.10, and the libraries below.

```bash
git clone https://github.com/TeivrimOriginal/Teivrim-Engine.git
cd Teivrim-Engine
mkdir build && cd build
cmake ..
cmake --build . --config Release
```

### Dependencies

| Library | Role |
|---------|------|
| [GLFW](https://www.glfw.org) | Windowing and input |
| [GLEW](https://github.com/nigels-com/glew) | OpenGL extension loading |
| [GLM](https://github.com/g-truc/glm) | Vector and matrix math |
| [Assimp](https://www.assimp.org) | Model import (FBX/OBJ/MTL) |
| [stb](https://github.com/nothings/stb) | `stb_truetype`, `stb_image`, `stb_image_write` |
| Vulkan SDK | Optional, for the Vulkan backend and SPIR-V compilation |
| slang | Optional, for the experimental shader path |

Venders headers for GLFW, GLEW, GLM and Assimp are kept in `include/` so the project builds without a package manager.

Compiled binaries (`.dll`, `.lib`, `.exe`, `lib/`, `build/`) are **not** tracked in git — see `.gitignore`. Drop the DLLs into `lib/` after cloning.

### What CI can and cannot do here

Because the import libraries are not tracked, a clean checkout cannot be linked,
so CI does not run `cmake --build`. It does run the two checks that need no
binaries:

1. **Every path in `CMakeLists.txt` exists.** This one already earned its keep:
   the list referenced `src/Core/Render/Win32/RenderUI.cpp`,
   `src/Core/Render/Win32/rendererw.cpp` and
   `src/Core/Render/Win32/stb_truetype_impl.cpp`, none of which were ever in the
   repository, so `cmake ..` stopped with "Cannot find source file" before
   compiling anything.
2. **All 14 translation units pass a syntax-only compile.** Vulkan headers are
   fetched at a pinned tag because they are not vendored either.

The project targets MSVC and the check runs MinGW-w64 g++, so it is a real check
rather than the last word. Linking stays a local step.

## Repository layout

```
src/
  main.cpp                    entry point: Core engine; engine.GameLoop();
  Core/
    core.{h,cpp}              engine core and game loop
    PublicAPI.h               flat static facade (Window/Object/Camera)
    Render/
      AbstractRender.h        render interface + backend switch
      OpenGL/rendererw.*      OpenGL 4.x backend
      Vulkan/                 Vulkan backend: device, swapchain, 2nd pass, post
      Win32/                  Win32 renderer, UI batching, font glyph cache
      Parser/                 model parsing
    SecondComplexity/         scene, project, asset and icon management
  Interface/                  panels, inspector, object UI, fonts, JSON config
  Control/                    input, camera
  Application/                window + platform layer
  Poligon/                    shaders, SPIR-V artifacts, test models, config
  TEST/                       backend experiments (Vulkan, FBX parsing)
include/                      vendored third-party headers
```

## Notes

- Comment language in some older headers is still the original Russian and shows as mojibake in editors that assume UTF-8; these files are being migrated incrementally.
- `src/TEST/` contains backend experiments kept for reference. Not part of the shipped executable.

## License

MIT

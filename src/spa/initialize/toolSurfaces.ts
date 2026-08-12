import {
  registerBuiltinToolSurfaces as registerSurfaces,
  registerLazyBuiltinToolSurfaces,
} from '@lobechat/builtin-tools/register';

let registered = false;

/** Sync: core tool UIs before first paint. */
export const registerBuiltinToolSurfaces = () => {
  if (registered) return;
  registered = true;

  registerSurfaces();
};

/** After first paint: optional/heavy tool UIs as async chunks. */
export const registerLazyBuiltinToolSurfacesAfterPaint = () => {
  void registerLazyBuiltinToolSurfaces();
};

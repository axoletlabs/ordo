import { createContext, useContext } from "react";

/** Cold content yields to the native push; already-mounted content never
 * unmounts on blur, a return navigation, or an overlay. */
export const SceneReadyContext = createContext(true);
export const useSceneReady = () => useContext(SceneReadyContext);

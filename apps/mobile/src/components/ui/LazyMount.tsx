import React, { useState } from "react";

/** Defer feature hooks/queries until first use; retain drafts through exit and
 * reuse already-prepared controls on subsequent opens. `children` is a factory
 * so neither the feature nor its hook subscriptions mount on the launch path.
 */
export function LazyMount({ active, children }: { active: boolean; children: () => React.ReactNode }) {
  const [activated, setActivated] = useState(active);
  if (active && !activated) setActivated(true);
  return activated || active ? children() : null;
}

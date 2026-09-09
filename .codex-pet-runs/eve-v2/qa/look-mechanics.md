# EVE look mechanics

EVE should look around through her existing physical construction, not by rotating the whole sprite. Her lower egg-shaped body stays centered and vertically registered. The glossy black visor/head leads with restrained yaw and pitch, while the cyan LED eyes move and reshape together on the visor surface. Her small side arms remain attached and mostly stable, with only subtle continuous follow-through.

Motion budget: each 22.5-degree step changes visor orientation, visible side contour, and LED-eye placement by a similar amount. Body scale, baseline, white shell proportions, black visor size, materials, highlights, and arm attachment points remain consistent. No step may snap, flip, or introduce a new expression.

Cardinal pose families:

- 000 up: torso anchored; visor pitches upward; eyes sit visibly high in the visor and narrow slightly from the upward angle; lower visor rim becomes a little more visible.
- 090 screen-right: visor turns unmistakably toward the image's right edge; the right-facing silhouette and eye placement shift right of head center; EVE's screen-right side becomes more visible while the far side compresses.
- 180 down: torso anchored; visor pitches downward; eyes sit visibly low in the visor and narrow slightly; upper shell/forehead becomes more visible.
- 270 screen-left: visor turns unmistakably toward the image's left edge; the left-facing silhouette and eye placement shift left of head center; EVE's screen-left side becomes more visible while the far side compresses.

Diagonals interpolate the neighboring cardinal families evenly. The eyes and visor lead; the upper shell follows subtly; the lower body remains the stable anchor. The LED eyes stay embedded in the visor, never become floating dots or replacement googly eyes. Arms neither swap sides nor detach.

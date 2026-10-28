// What the toolkit knows about each RPG Maker engine it publishes, in one
// place, so the rest of cli/ asks this table instead of comparing names.
// Both engines get the same runtime plugins (RUNTIME_PLUGINS in stage.js).

export const ENGINES = {
  MZ: {
    marker: ["js", "rmmz_core.js"], // the file that tells a game apart
    saveExtension: ".rmmzsave",
    usesGameId: true, // System.json's advanced.gameId identifies the game
    mobileMedia: false, // plays .ogg / .webm everywhere
    retitlesGlobal: false,
  },
  MV: {
    marker: ["js", "rpg_core.js"],
    saveExtension: ".rpgsave",
    usesGameId: false,
    mobileMedia: true, // asks phones for .m4a audio and .mp4 movies
    retitlesGlobal: true, // a browser hides saves whose title in global differs
  },
};

// The engine of a web build: its name, or null. exists(...segments) checks a
// path below the build's root.
export function detectEngine(exists) {
  return Object.keys(ENGINES).find((name) => exists(...ENGINES[name].marker)) || null;
}

// The table's entry for a name, MZ's when the name is unknown (an old config).
export function engineOf(name) {
  return ENGINES[name] || ENGINES.MZ;
}

// "neither js/rmmz_core.js nor js/rpg_core.js"
export function markerList() {
  const files = Object.values(ENGINES).map((e) => e.marker.join("/"));
  return files.length > 1 ? `neither ${files.slice(0, -1).join(", ")} nor ${files.at(-1)}` : `no ${files[0]}`;
}

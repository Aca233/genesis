export const GENESIS_TOP_LEVEL_KEYS = [
  "mode",
  "worldName",
  "cosmology",
  "fusionAxiom",
  "playerGod",
  "majorGods",
  "minorGods",
  "factions",
  "races",
  "places",
  "majorCharacters",
  "epochConflict",
  "canonEvents",
  "style",
  "theme",
] as const;

export type GenesisTopLevelKey = (typeof GENESIS_TOP_LEVEL_KEYS)[number];

const allowedKeys = new Set<string>(GENESIS_TOP_LEVEL_KEYS);
type RootState = "keyOrEnd" | "colon" | "value" | "commaOrEnd";
type StringContext = "key" | "value" | "nested";

/**
 * Incremental lexical scanner for a streamed top-level JSON object.
 * It deliberately does not attempt to validate the full document. It only emits a
 * known top-level key after that key's JSON value is lexically complete.
 */
export class TopLevelJsonProgressScanner {
  private raw = "";
  private started = false;
  private depth = 0;
  private rootState: RootState = "keyOrEnd";
  private inString = false;
  private escaped = false;
  private stringContext: StringContext = "nested";
  private stringBuffer = "";
  private currentKey: string | null = null;
  private primitiveBuffer = "";
  private primitiveActive = false;
  private structuredValueActive = false;
  private valueBuffer = "";
  private readonly emitted = new Set<GenesisTopLevelKey>();

  push(chunk: string): GenesisTopLevelKey[] {
    this.raw += chunk;
    const newlyCompleted: GenesisTopLevelKey[] = [];

    for (const character of chunk) {
      if (!this.started) {
        if (character === "{") {
          this.started = true;
          this.depth = 1;
          this.rootState = "keyOrEnd";
        }
        continue;
      }

      if (this.inString) {
        if (this.stringContext !== "key") this.valueBuffer += character;
        if (this.escaped) {
          this.escaped = false;
          if (this.stringContext === "key") this.stringBuffer += character;
          continue;
        }
        if (character === "\\") {
          this.escaped = true;
          if (this.stringContext === "key") this.stringBuffer += character;
          continue;
        }
        if (character !== '"') {
          if (this.stringContext === "key") this.stringBuffer += character;
          continue;
        }

        this.inString = false;
        if (this.stringContext === "key") {
          this.currentKey = this.stringBuffer;
          this.rootState = "colon";
        } else if (this.stringContext === "value") {
          this.completeCurrentValue(newlyCompleted);
        }
        continue;
      }

      if (this.structuredValueActive) {
        this.valueBuffer += character;
        if (character === '"') {
          this.startString("nested");
          continue;
        }
        if (character === "{" || character === "[") {
          this.depth += 1;
          continue;
        }
        if (character === "}" || character === "]") {
          this.depth -= 1;
          if (this.depth === 1) {
            this.structuredValueActive = false;
            this.completeCurrentValue(newlyCompleted);
          }
        }
        continue;
      }

      if (this.primitiveActive) {
        if (character === "," || character === "}") {
          this.finishPrimitive(newlyCompleted);
          if (character === ",") this.rootState = "keyOrEnd";
          else this.depth = 0;
        } else if (/\s/.test(character)) {
          this.finishPrimitive(newlyCompleted);
        } else {
          this.primitiveBuffer += character;
        }
        continue;
      }

      if (this.depth !== 1) continue;

      if (this.rootState === "keyOrEnd") {
        if (character === '"') this.startString("key");
        else if (character === "}") this.depth = 0;
        continue;
      }

      if (this.rootState === "colon") {
        if (character === ":") this.rootState = "value";
        continue;
      }

      if (this.rootState === "value") {
        if (/\s/.test(character)) continue;
        if (character === '"') {
          this.valueBuffer = '"';
          this.startString("value");
        } else if (character === "{" || character === "[") {
          this.depth += 1;
          this.structuredValueActive = true;
          this.valueBuffer = character;
        } else {
          this.primitiveActive = true;
          this.primitiveBuffer = character;
        }
        continue;
      }

      if (this.rootState === "commaOrEnd") {
        if (character === ",") this.rootState = "keyOrEnd";
        else if (character === "}") this.depth = 0;
      }
    }

    return newlyCompleted;
  }

  getRaw(): string {
    return this.raw;
  }

  private startString(context: StringContext) {
    this.inString = true;
    this.escaped = false;
    this.stringContext = context;
    this.stringBuffer = "";
  }

  private finishPrimitive(completed: GenesisTopLevelKey[]) {
    if (!this.primitiveActive) return;
    try {
      JSON.parse(this.primitiveBuffer);
      this.completeCurrentValue(completed);
    } catch {
      // An incomplete/invalid primitive is not progress; final schema validation
      // will provide the authoritative error after the stream ends.
    }
    this.primitiveActive = false;
    this.primitiveBuffer = "";
  }

  private completeCurrentValue(completed: GenesisTopLevelKey[]) {
    let validValue = true;
    if (this.valueBuffer) {
      try {
        JSON.parse(this.valueBuffer);
      } catch {
        validValue = false;
      }
    }
    if (validValue && this.currentKey && allowedKeys.has(this.currentKey)) {
      const key = this.currentKey as GenesisTopLevelKey;
      if (!this.emitted.has(key)) {
        this.emitted.add(key);
        completed.push(key);
      }
    }
    this.currentKey = null;
    this.valueBuffer = "";
    this.rootState = "commaOrEnd";
  }
}

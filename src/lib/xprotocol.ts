export type XProtocolValue = string | number;

export interface XProtocolParamValueNode {
  kind: "value";
  name: string;
  type: string;
  values: XProtocolValue[];
}

export interface XProtocolArrayValue {
  values: XProtocolValue[];
  children: XProtocolArrayValue[];
}

export interface XProtocolParamMapNode {
  kind: "map";
  name: string;
  type: string;
  children: XProtocolNode[];
}

export interface XProtocolParamArrayNode {
  kind: "array";
  name: string;
  type: string;
  defaultNode: XProtocolNode;
  values: XProtocolArrayValue[];
  children: XProtocolNode[];
}

export type XProtocolNode = XProtocolParamMapNode | XProtocolParamArrayNode | XProtocolParamValueNode;

export function parseXProtocol(input: string): XProtocolNode {
  const parser = new XProtocolParser(input);
  return parser.parse();
}

export function getChildNodeByName(node: XProtocolNode, name: string): XProtocolNode | null {
  const parts = name.split(".").filter(Boolean);
  return getChildNodeByParts(node, parts);
}

export function getStringValueArray(node: XProtocolNode): string[] {
  if (node.kind !== "value") return [];
  return node.values.map((value) => String(value));
}

function getChildNodeByParts(node: XProtocolNode, parts: string[]): XProtocolNode | null {
  if (parts.length === 0) return node;

  const [level, ...rest] = parts;

  if (node.kind === "map") {
    const child = node.children.find((entry) => entry.name.toLowerCase() === level.toLowerCase()) ?? null;
    return child ? getChildNodeByParts(child, rest) : null;
  }

  if (node.kind === "array") {
    const index = Number.parseInt(level, 10);
    if (!Number.isFinite(index)) return null;
    expandChildren(node);
    const child = node.children[index] ?? null;
    return child ? getChildNodeByParts(child, rest) : null;
  }

  return null;
}

function expandChildren(node: XProtocolParamArrayNode): void {
  if (node.children.length > 0) return;
  node.children = node.values.map((value) => applyArrayValue(cloneNode(node.defaultNode), value));
}

function applyArrayValue(node: XProtocolNode, value: XProtocolArrayValue): XProtocolNode {
  if (node.kind === "map") {
    for (let index = 0; index < Math.min(node.children.length, value.children.length); index += 1) {
      node.children[index] = applyArrayValue(node.children[index], value.children[index]);
    }
    return node;
  }

  if (node.kind === "array") {
    node.values = [...value.children];
    node.children = [];
    expandChildren(node);
    return node;
  }

  node.values = [...value.values];
  return node;
}

function cloneNode(node: XProtocolNode): XProtocolNode {
  if (node.kind === "value") {
    return { ...node, values: [...node.values] };
  }

  if (node.kind === "map") {
    return { ...node, children: node.children.map(cloneNode) };
  }

  return {
    ...node,
    defaultNode: cloneNode(node.defaultNode),
    values: node.values.map(cloneArrayValue),
    children: node.children.map(cloneNode)
  };
}

function cloneArrayValue(value: XProtocolArrayValue): XProtocolArrayValue {
  return {
    values: [...value.values],
    children: value.children.map(cloneArrayValue)
  };
}

class XProtocolParser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): XProtocolNode {
    this.skipWhitespace();
    const root = this.parseXProtocolRoot();
    const firstChild = root.children[0];
    if (!firstChild || firstChild.kind !== "map") {
      throw new Error("Failed to parse XProtocol root");
    }
    this.skipWhitespace();
    return firstChild;
  }

  private parseXProtocolRoot(): XProtocolParamMapNode {
    this.expectLiteral("<XProtocol>");
    this.skipWhitespace();
    this.expectChar("{");
    const children: XProtocolNode[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.peekChar() === "}") {
        this.position += 1;
        break;
      }

      if (this.tryConsumePropertyLikeTag("Name")) continue;
      if (this.tryConsumePropertyLikeTag("ID")) continue;
      if (this.tryConsumePropertyLikeTag("Userversion")) continue;
      if (this.tryConsumePropertyLikeTag("EVAStringTable")) continue;
      if (this.tryConsumeParamCardLayout()) continue;
      if (this.tryConsumeDependency()) continue;

      children.push(this.parseNode());
    }

    return { kind: "map", name: "XProtocol", type: "XProtocol", children };
  }

  private parseNode(): XProtocolNode {
    this.skipWhitespace();
    if (this.peekLiteral('<ParamMap."') || this.peekLiteral('<Pipe."') || this.peekLiteral('<PipeService."') || this.peekLiteral('<ParamFunctor."')) {
      return this.parseParamMap();
    }
    if (this.peekLiteral('<ParamArray."')) {
      return this.parseParamArray();
    }
    return this.parseParamGeneric();
  }

  private parseParamMap(): XProtocolParamMapNode {
    const type = this.readMapTagType();
    const name = this.readQuotedTagName();
    this.expectChar(">");
    this.expectChar("{");
    const children: XProtocolNode[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.peekChar() === "}") {
        this.position += 1;
        break;
      }
      if (this.tryConsumeKnownBurnProperty()) continue;
      children.push(this.parseNode());
    }

    return { kind: "map", name, type, children };
  }

  private parseParamArray(): XProtocolParamArrayNode {
    this.expectLiteral('<ParamArray."');
    const name = this.readUntil('"');
    this.expectChar('"');
    this.expectChar(">");
    this.expectChar("{");

    while (this.tryConsumeArrayBurnProperty()) {
      // burn
    }

    this.expectLiteral("<Default>");
    const defaultNode = this.parseNode();
    const values: XProtocolArrayValue[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.peekChar() === "}") {
        this.position += 1;
        break;
      }
      values.push(this.parseArrayValue());
    }

    return { kind: "array", name, type: "ParamArray", defaultNode, values, children: [] };
  }

  private parseParamGeneric(): XProtocolParamValueNode {
    this.expectChar("<");
    const type = this.readUntil(".");
    this.expectChar(".");
    const name = this.readQuotedString();
    this.expectChar(">");
    this.expectChar("{");

    while (this.tryConsumeKnownBurnProperty()) {
      // burn
    }

    const values: XProtocolValue[] = [];
    while (true) {
      this.skipWhitespace();
      if (this.peekChar() === "}") {
        this.position += 1;
        break;
      }
      if (this.peekLiteral("<Line>")) {
        this.expectLiteral("<Line>");
        this.skipBalancedBlock();
        continue;
      }
      values.push(this.parsePrimitiveValue());
    }

    return { kind: "value", name, type, values };
  }

  private parseArrayValue(): XProtocolArrayValue {
    this.skipWhitespace();
    this.expectChar("{");
    while (this.tryConsumeKnownBurnProperty()) {
      // burn
    }

    const values: XProtocolValue[] = [];
    const children: XProtocolArrayValue[] = [];

    while (true) {
      this.skipWhitespace();
      if (this.peekChar() === "}") {
        this.position += 1;
        break;
      }
      if (this.peekChar() === "{") {
        children.push(this.parseArrayValue());
        continue;
      }
      values.push(this.parsePrimitiveValue());
    }

    return { values, children };
  }

  private parsePrimitiveValue(): XProtocolValue {
    this.skipWhitespace();
    if (this.peekChar() === '"') return this.readQuotedString();
    return this.readNumber();
  }

  private readNumber(): number {
    this.skipWhitespace();
    const start = this.position;
    while (!this.isAtEnd()) {
      const char = this.input[this.position];
      if (!/[0-9eE+.\-]/.test(char)) break;
      this.position += 1;
    }
    const raw = this.input.slice(start, this.position);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric value: ${raw}`);
    }
    return value;
  }

  private readQuotedString(): string {
    this.skipWhitespace();
    this.expectChar('"');
    const value = this.readUntil('"');
    this.expectChar('"');
    return value;
  }

  private readQuotedTagName(): string {
    this.expectChar('"');
    const name = this.readUntil('"');
    this.expectChar('"');
    return name;
  }

  private readMapTagType(): string {
    this.expectChar("<");
    const type = this.readUntil(".");
    this.expectChar(".");
    return type;
  }

  private tryConsumeKnownBurnProperty(): boolean {
    const names = [
      "Default",
      "Precision",
      "MinSize",
      "MaxSize",
      "Comment",
      "Visible",
      "Tooltip",
      "Class",
      "Label",
      "Unit",
      "InFile",
      "Dll",
      "Repr",
      "LimitRange",
      "Limit",
      "DefaultSize",
      "Control",
      "Line"
    ];
    for (const name of names) {
      if (this.tryConsumePropertyLikeTag(name)) return true;
    }
    return false;
  }

  private tryConsumeArrayBurnProperty(): boolean {
    const names = ["Visible", "DefaultSize", "MinSize", "Label", "MaxSize", "Comment"];
    for (const name of names) {
      if (this.tryConsumePropertyLikeTag(name)) return true;
    }
    return false;
  }

  private tryConsumeParamCardLayout(): boolean {
    this.skipWhitespace();
    const start = this.position;
    if (!this.peekLiteral("<ParamCardLayout.")) return false;
    this.expectLiteral("<ParamCardLayout.");
    this.readQuotedString();
    this.expectChar(">");
    this.expectChar("{");
    while (true) {
      this.skipWhitespace();
      if (this.peekChar() === "}") {
        this.position += 1;
        return true;
      }
      if (this.tryConsumePropertyLikeTag("Repr")) continue;
      if (this.peekLiteral("<Control>")) {
        this.expectLiteral("<Control>");
        this.skipBalancedBlock();
        continue;
      }
      if (this.peekLiteral("<Line>")) {
        this.expectLiteral("<Line>");
        this.skipBalancedBlock();
        continue;
      }
      this.position = start;
      return false;
    }
  }

  private tryConsumeDependency(): boolean {
    this.skipWhitespace();
    if (!(this.peekLiteral("<Dependency.") || this.peekLiteral("<ProtocolComposer."))) return false;
    this.expectChar("<");
    this.readUntil(".");
    this.expectChar(".");
    this.readQuotedString();
    this.expectChar(">");
    this.expectChar("{");
    this.skipUntilMatchingBrace();
    return true;
  }

  private tryConsumePropertyLikeTag(name: string): boolean {
    this.skipWhitespace();
    const start = this.position;
    if (!this.peekLiteral(`<${name}>`)) return false;
    this.expectLiteral(`<${name}>`);
    this.skipWhitespace();
    if (this.peekChar() === "{") {
      this.skipBalancedBlock();
      return true;
    }
    if (this.peekChar() === '"') {
      this.readQuotedString();
      return true;
    }
    if (this.peekChar() === "<") {
      this.position = start;
      return false;
    }
    this.readBareToken();
    return true;
  }

  private readBareToken(): string {
    this.skipWhitespace();
    const start = this.position;
    while (!this.isAtEnd()) {
      const char = this.input[this.position];
      if (/\s/.test(char) || char === "{" || char === "}" || char === "<") break;
      this.position += 1;
    }
    return this.input.slice(start, this.position);
  }

  private skipBalancedBlock(): void {
    this.skipWhitespace();
    this.expectChar("{");
    this.skipUntilMatchingBrace();
  }

  private skipUntilMatchingBrace(): void {
    let depth = 1;
    while (!this.isAtEnd() && depth > 0) {
      const char = this.input[this.position++];
      if (char === '"') {
        while (!this.isAtEnd()) {
          const next = this.input[this.position++];
          if (next === '"') break;
        }
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
    }
  }

  private readUntil(terminator: string): string {
    const start = this.position;
    while (!this.isAtEnd() && this.input[this.position] !== terminator) {
      this.position += 1;
    }
    return this.input.slice(start, this.position);
  }

  private expectLiteral(value: string): void {
    this.skipWhitespace();
    if (!this.peekLiteral(value)) {
      throw new Error(`Expected ${value} at ${this.position}`);
    }
    this.position += value.length;
  }

  private expectChar(value: string): void {
    this.skipWhitespace();
    if (this.input[this.position] !== value) {
      throw new Error(`Expected ${value} at ${this.position}`);
    }
    this.position += 1;
  }

  private peekLiteral(value: string): boolean {
    return this.input.slice(this.position, this.position + value.length) === value;
  }

  private peekChar(): string {
    return this.input[this.position] ?? "";
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd() && /\s/.test(this.input[this.position])) {
      this.position += 1;
    }
  }

  private isAtEnd(): boolean {
    return this.position >= this.input.length;
  }
}

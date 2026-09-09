import jsdoc2md from "jsdoc-to-markdown";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const docsApiDir = path.join(rootDir, "docs", "client_api");

if (!fs.existsSync(docsApiDir)) {
    fs.mkdirSync(docsApiDir, { recursive: true });
}

function isPublic(item) {
    if (!item || !item.name) return false;
    if (item.name.startsWith("_")) return false;
    if (item.access === "private" || item.access === "protected" || item.access === "package" || item.ignore) return false;
    if (item.customTags && item.customTags.some(t => t.tag === "internal" || t.tag === "ignore")) return false;
    return true;
}

function formatType(typeObj) {
    if (!typeObj || !typeObj.names) return "";
    return typeObj.names.map(t => `\`${t}\``).join(" | ");
}

function formatParamsTable(params) {
    if (!params || params.length === 0) return "";
    let md = "| Parameter | Type | Description |\n| --- | --- | --- |\n";
    for (const p of params) {
        const pName = p.optional ? `\`[${p.name}]\`` : `\`${p.name}\``;
        const pType = formatType(p.type);
        const pDesc = p.description || "";
        md += `| ${pName} | ${pType} | ${pDesc} |\n`;
    }
    return md + "\n";
}

function formatMethod(item) {
    const returnsType = item.returns && item.returns[0] ? formatType(item.returns[0].type) : "";
    const returnsDesc = item.returns && item.returns[0] && item.returns[0].description ? ` - ${item.returns[0].description}` : "";
    
    let md = `### \`${item.name}(${(item.params || []).map(p => p.name).join(", ")})\`\n\n`;
    if (item.description) {
        md += `${item.description}\n\n`;
    }
    if (item.params && item.params.length > 0) {
        md += formatParamsTable(item.params);
    }
    if (returnsType) {
        md += `**Returns**: ${returnsType}${returnsDesc}\n\n`;
    }
    return md;
}

function formatProperty(item) {
    const propType = formatType(item.type);
    let md = `### \`${item.name}\`\n\n`;
    if (propType) md += `**Type**: ${propType}\n\n`;
    if (item.description) md += `${item.description}\n\n`;
    return md;
}

// 1. Overview Page
async function generateOverviewDoc() {
    const overviewContent = [
        "# SharedState Client API",
        "",
        "The SharedState client is implemented in JavaScript. It encapsulates management of state replication, connection and client subscriptions, while providing easy-to-use programming abstractions modelling shared resources. The SharedState Client API is organized in two parts:",
        "",
        "### Client API",
        "",
        "   - **[`SharedStateClient API`](/client_api/client)**: The client object maintains a WebSocket connection to a SharedState server.",
        "   - **[`Connection API`](/client_api/connection)**: The connection object provides access to the state of the connection.",
        "   - **[`ServerClock API`](/client_api/clock)**: The server clock object provides access to an approximation of the server clock.",
        "",
        "",
        "### Abstractions API",
        "",
        "   - **[`Event API`](/client_api/events)**: The event observation interface implemented by all SharedState abstractions.",
        "   - **[`SharedVariables API`](/client_api/variables)**: Abstractions representing shared, single-valued variables, typed and untyped.",
        "   - **[`SharedMap API`](/client_api/map)**: Abstraction representing a shared key-value map.",
        "   - **[`SharedSet API`](/client_api/set)**: Abstraction implementing a shared set.",
        ""
    ].join("\n");

    fs.writeFileSync(path.join(docsApiDir, "overview.md"), overviewContent, "utf8");
    console.log("Generated overview.md");
}

// 2. Events Dedicated Page
async function generateEventsDoc() {
    const eventsContent = [
        "# Event Mechanism",
        "",
        "All SharedState state objects (`SharedVariables`, `SharedMap`, `SharedSet`) provide decoupled event handling capabilities (`.on`, `.off`, `.once`). They emit a **`\"change\"`** event whenever state updates locally or over the network.",
        "",
        "## Subscribing (`.on`)",
        "",
        "Subscribe to state change events on any variable, map, or set.",
        "",
        "```javascript",
        "const handle = stateObject.on(\"change\", (valueOrChanges, eInfo) => {",
        "    console.log(\"Updated Payload:\", valueOrChanges);",
        "    console.log(\"Is Initial Snapshot:\", eInfo.init);",
        "});",
        "```",
        "",
        "### Callback Arguments",
        "1. **`valueOrChanges`**: Event payload.",
        "   - **For SharedVariables**: The newly updated variable value.",
        "   - **For SharedMap & SharedSet**: A delta change object `{ insert, remove, reset }`.",
        "2. **`eInfo`**: Event metadata object containing:",
        "   - `src`: Source state object instance emitting the event.",
        "   - `name`: Event name string (`\"change\"`).",
        "   - `count`: Number of times this event handler has executed.",
        "   - `init`: Boolean indicating whether this invocation is the initial state snapshot.",
        "   - `handle`: Subscription handle object.",
        "",
        "### Subscription Options",
        "- **`options.init`** (`boolean`): When set to `true`, immediately delivers the current state snapshot to the callback upon subscription.",
        "",
        "## Unsubscribing (`.off`)",
        "",
        "Unsubscribe from event updates.",
        "",
        "```javascript",
        "// Option A: Unsubscribe via handle",
        "handle.off();",
        "",
        "// Option B: Unsubscribe by event name and callback reference",
        "stateObject.off(\"change\", callback);",
        "```",
        "",
        "## One-Time Listeners (`.once`)",
        "",
        "Subscribe to a single state change execution.",
        "",
        "```javascript",
        "stateObject.once(\"change\", (eArg, eInfo) => {",
        "    console.log(\"Received first update:\", eArg);",
        "});",
        "```",
        ""
    ].join("\n");

    fs.writeFileSync(path.join(docsApiDir, "events.md"), eventsContent, "utf8");
    console.log("Generated events.md");
}

// 3. SharedStateClient Page
async function generateClientDoc() {
    const files = [
        path.join(rootDir, "client", "client.js")
    ];
    const data = await jsdoc2md.getTemplateData({ files });
    
    let md = `# SharedStateClient\n\n`;
    md += `The \`SharedStateClient\` manages logical network connections, subscriptions, state providers, and application objects.\n\n`;
    
    // Constructor
    const ctor = data.find(d => d.kind === "constructor" && d.memberof === "SharedStateClient#SharedStateClient");
    if (ctor) {
        md += `## Constructor\n\n`;
        md += `### \`new SharedStateClient(url, [options])\`\n\n`;
        if (ctor.description) md += `${ctor.description}\n\n`;
        if (ctor.params) md += formatParamsTable(ctor.params);
    }
    
    // Client Properties
    const props = data.filter(d => d.kind === "member" && d.memberof === "SharedStateClient" && isPublic(d));
    if (props.length > 0) {
        md += `## Accessors & Properties\n\n`;
        for (const p of props) {
            md += formatProperty(p);
        }
    }
    
    // Client Methods
    const methods = data.filter(d => d.kind === "function" && d.memberof === "SharedStateClient" && isPublic(d));
    if (methods.length > 0) {
        md += `## Methods\n\n`;
        for (const m of methods) {
            md += formatMethod(m);
        }
    }

    md += `\n> See **[Connection](/client_api/connection)** for details on \`client.connection\`.\n`;
    md += `> See **[Server Clock](/client_api/clock)** for details on \`client.clock\`.\n`;

    fs.writeFileSync(path.join(docsApiDir, "client.md"), md, "utf8");
    console.log("Generated client.md");
}

// 4. Connection Dedicated Page
async function generateConnectionDoc() {
    const files = [
        path.join(rootDir, "client", "wsio.js")
    ];
    const data = await jsdoc2md.getTemplateData({ files });
    
    let md = `# Connection\n\n`;
    md += `The \`client.connection\` instance (\`Connection\`) manages transport connection state, automatic reconnects, and connection lifecycle events.\n\n`;
    
    md += `## ConnectionState Enum\n\n`;
    md += `Valid connection state strings:\n`;
    md += `- \`\"disconnected\"\`\n- \`\"connecting\"\`\n- \`\"connected\"\`\n- \`\"terminated\"\`\n\n`;

    const props = data.filter(d => d.kind === "member" && d.memberof === "Connection" && isPublic(d));
    if (props.length > 0) {
        md += `## Properties\n\n`;
        for (const p of props) {
            md += formatProperty(p);
        }
    }
    
    const methods = data.filter(d => d.kind === "function" && d.memberof === "Connection" && isPublic(d));
    if (methods.length > 0) {
        md += `## Methods\n\n`;
        for (const m of methods) {
            md += formatMethod(m);
        }
    }

    fs.writeFileSync(path.join(docsApiDir, "connection.md"), md, "utf8");
    console.log("Generated connection.md");
}

// 5. Clock (ServerClock) Dedicated Page
async function generateClockDoc() {
    const files = [
        path.join(rootDir, "client", "server_clock.js")
    ];
    const data = await jsdoc2md.getTemplateData({ files });
    
    let md = `# Server Clock\n\n`;
    md += `The \`client.clock\` instance (\`ServerClock\`) estimates high-precision server time, clock skew, and transit latency.\n\n`;
    
    const props = data.filter(d => d.kind === "member" && d.memberof === "ServerClock" && isPublic(d));
    if (props.length > 0) {
        md += `## Properties\n\n`;
        for (const p of props) {
            md += formatProperty(p);
        }
    }
    
    const methods = data.filter(d => d.kind === "function" && d.memberof === "ServerClock" && isPublic(d));
    if (methods.length > 0) {
        md += `## Methods\n\n`;
        for (const m of methods) {
            md += formatMethod(m);
        }
    }

    fs.writeFileSync(path.join(docsApiDir, "clock.md"), md, "utf8");
    console.log("Generated clock.md");
}

// 6. SharedVariables Page
async function generateVariablesDoc() {
    const files = [
        path.join(rootDir, "client", "objects", "variables.js"),
        path.join(rootDir, "client", "base_objects", "base_variable.js")
    ];
    const data = await jsdoc2md.getTemplateData({ files });
    
    let md = `# SharedVariables\n\n`;
    md += `SharedVariables are reactive, single-value abstractions synchronized in real time across clients and server.\n\n`;
    
    md += `> [!NOTE]\n`;
    md += `> All SharedVariable instances emit a **\`"change"\`** event with callback signature \`callback(newValue, eInfo)\` whenever their local or remote value updates. See **[Event Mechanism](/client_api/events)** for details.\n\n`;
    
    const baseVarMethods = data.filter(d => d.memberof === "BaseVariable" && isPublic(d));

    // Common variable interface
    md += `## SharedVariable Common Interface\n\n`;
    md += `All SharedVariable types support the following properties and methods:\n\n`;
    for (const item of baseVarMethods) {
        if (item.kind === "member") {
            md += formatProperty(item);
        } else if (item.kind === "function") {
            md += formatMethod(item);
        }
    }

    const varClasses = [
        { name: "SharedVariable", desc: "Generic untyped shared variable holding any serializable value." },
        { name: "SharedBoolean", desc: "Shared boolean variable." },
        { name: "SharedString", desc: "Shared string variable." },
        { name: "SharedInteger", desc: "Shared integer variable supporting increment and decrement operations." },
        { name: "SharedFloat", desc: "Shared floating-point number variable." },
        { name: "SharedObject", desc: "Shared JSON object variable." },
        { name: "SharedArray", desc: "Shared array variable." }
    ];

    for (const cls of varClasses) {
        md += `## ${cls.name}\n\n${cls.desc}\n\n`;
        const clsMethods = data.filter(d => d.memberof === cls.name && isPublic(d) && d.kind === "function");
        if (clsMethods.length > 0) {
            md += `### Specific Methods\n\n`;
            for (const m of clsMethods) {
                md += formatMethod(m);
            }
        }
    }

    fs.writeFileSync(path.join(docsApiDir, "variables.md"), md, "utf8");
    console.log("Generated variables.md");
}

// 7. SharedMap Page
async function generateMapDoc() {
    const files = [
        path.join(rootDir, "client", "objects", "map.js")
    ];
    const data = await jsdoc2md.getTemplateData({ files });
    
    let md = `# SharedMap\n\n`;
    md += `\`SharedMap\` is a replicated map data structure mirroring the standard JavaScript \`Map\` interface with real-time network synchronization.\n\n`;
    
    md += `> [!NOTE]\n`;
    md += `> \`SharedMap\` emits a **\`"change"\`** event with callback signature \`callback(changes, eInfo)\` where \`changes\` is a delta object containing \`{ insert, remove, reset }\`. See **[Event Mechanism](/client_api/events)** for details.\n\n`;
    
    md += `## Constructor\n\n`;
    md += `### \`new SharedMap(client, path, [options])\`\n\n`;
    md += `Initializes a new \`SharedMap\` instance.\n\n`;
    md += `| Parameter | Type | Description |\n| --- | --- | --- |\n`;
    md += `| \`client\` | \`SharedStateClient\` | Parent SharedState client instance |\n`;
    md += `| \`path\` | \`string\` | Target path prefix for the map |\n`;
    md += `| \`[options]\` | \`Object\` | Configuration options |\n\n`;
    
    const methods = data.filter(d => d.memberof === "SharedMap" && isPublic(d) && d.kind === "function");
    if (methods.length > 0) {
        md += `## Methods\n\n`;
        for (const m of methods) {
            md += formatMethod(m);
        }
    }
    
    fs.writeFileSync(path.join(docsApiDir, "map.md"), md, "utf8");
    console.log("Generated map.md");
}

// 8. SharedSet Page
async function generateSetDoc() {
    const files = [
        path.join(rootDir, "client", "objects", "set.js")
    ];
    const data = await jsdoc2md.getTemplateData({ files });
    
    let md = `# SharedSet\n\n`;
    md += `\`SharedSet\` is a replicated set data structure mirroring the standard JavaScript \`Set\` interface with real-time network synchronization.\n\n`;
    
    md += `> [!NOTE]\n`;
    md += `> \`SharedSet\` emits a **\`"change"\`** event with callback signature \`callback(changes, eInfo)\` where \`changes\` is a delta object containing \`{ insert, remove, reset }\`. See **[Event Mechanism](/client_api/events)** for details.\n\n`;
    
    md += `## Constructor\n\n`;
    md += `### \`new SharedSet(client, path, [options])\`\n\n`;
    md += `Initializes a new \`SharedSet\` instance.\n\n`;
    md += `| Parameter | Type | Description |\n| --- | --- | --- |\n`;
    md += `| \`client\` | \`SharedStateClient\` | Parent SharedState client instance |\n`;
    md += `| \`path\` | \`string\` | Target path prefix for the set |\n`;
    md += `| \`[options]\` | \`Object\` | Configuration options |\n`;
    md += `| \`[options.key]\` | \`Function\` | Custom identity key function \`(elem) => id\` |\n\n`;
    
    const methods = data.filter(d => d.memberof === "SharedSet" && isPublic(d) && d.kind === "function");
    if (methods.length > 0) {
        md += `## Methods\n\n`;
        for (const m of methods) {
            md += formatMethod(m);
        }
    }
    
    fs.writeFileSync(path.join(docsApiDir, "set.md"), md, "utf8");
    console.log("Generated set.md");
}

async function generateAll() {
    console.log("Generating structured Client API documentation...");
    await generateOverviewDoc();
    await generateEventsDoc();
    await generateClientDoc();
    await generateConnectionDoc();
    await generateClockDoc();
    await generateVariablesDoc();
    await generateMapDoc();
    await generateSetDoc();
    console.log("Structured Client API documentation generated successfully.");
}

generateAll();

# Knowledge Graph Memory Server

A basic implementation of persistent memory using a local knowledge graph powered by Kuzu embedded
graph database.

## Core Concepts

### Entities

Entities are the primary nodes in the knowledge graph. Each entity has:

- A unique name (identifier)
- An entity type (e.g., "person", "organization", "event")
- A list of observations

Example:

```json
{
  "name": "John_Smith",
  "entityType": "person",
  "observations": ["Speaks fluent Spanish"]
}
```

### Relations

Relations define directed connections between entities. They are always stored in active voice and
describe how entities interact or relate to each other.

Example:

```json
{
  "from": "John_Smith",
  "to": "Anthropic",
  "relationType": "works_at"
}
```

### Observations

Observations are discrete pieces of information about an entity. They are:

- Stored as strings
- Attached to specific entities
- Can be added or removed independently
- Should be atomic (one fact per observation)

Example:

```json
{
  "entityName": "John_Smith",
  "observations": ["Speaks fluent Spanish", "Graduated in 2019", "Prefers morning meetings"]
}
```

### Tags

Tags provide a flexible way to categorize and organize entities and observations. They enable:

- Cross-cutting classification of entities and observations
- Easy filtering and discovery of related information
- Hierarchical organization with optional categories
- Metadata storage with descriptions

Example:

```json
{
  "name": "high-priority",
  "category": "priority",
  "description": "Items requiring immediate attention"
}
```

Tags can be applied to:

- **Entities**: For categorizing people, projects, concepts, etc.
- **Observations**: For marking specific facts with metadata like confidence, source, or relevance

## API

### Tools

- **create_entities**

  - Create multiple new entities in the knowledge graph
  - Input: `entities` (array of objects)
    - Each object contains:
      - `name` (string): Entity identifier
      - `entityType` (string): Type classification
      - `observations` (string[]): Associated observations
  - Ignores entities with existing names

- **create_relations**

  - Create multiple new relations between entities
  - Input: `relations` (array of objects)
    - Each object contains:
      - `from` (string): Source entity name
      - `to` (string): Target entity name
      - `relationType` (string): Relationship type in active voice
  - Skips duplicate relations

- **add_observations**

  - Add new observations to existing entities
  - Input: `observations` (array of objects)
    - Each object contains:
      - `entityName` (string): Target entity
      - `contents` (string[]): New observations to add
  - Returns added observations per entity
  - Fails if entity doesn't exist

- **delete_entities**

  - Remove entities and their relations
  - Input: `entityNames` (string[])
  - Cascading deletion of associated relations
  - Silent operation if entity doesn't exist

- **delete_observations**

  - Remove specific observations from entities
  - Input: `deletions` (array of objects)
    - Each object contains:
      - `entityName` (string): Target entity
      - `observations` (string[]): Observations to remove
  - Silent operation if observation doesn't exist

- **delete_relations**

  - Remove specific relations from the graph
  - Input: `relations` (array of objects)
    - Each object contains:
      - `from` (string): Source entity name
      - `to` (string): Target entity name
      - `relationType` (string): Relationship type
  - Silent operation if relation doesn't exist

- **read_graph**

  - Read the entire knowledge graph
  - No input required
  - Returns complete graph structure with all entities and relations

- **search_nodes**

  - Search for nodes based on query
  - Input: `query` (string)
  - Searches across:
    - Entity names
    - Entity types
    - Observation content
  - Returns matching entities and their relations

- **open_nodes**

  - Retrieve specific nodes by name
  - Input: `names` (string[])
  - Returns:
    - Requested entities
    - Relations between requested entities
  - Silently skips non-existent nodes

- **tag_entity**

  - Add tags to entities
  - Input: `entityName` (string), `tagNames` (string[])
  - Creates tags if they don't exist
  - Returns array of successfully added tags

- **tag_observation**

  - Add tags to specific observations
  - Input: `entityName` (string), `observationContent` (string), `tagNames` (string[])
  - Creates tags if they don't exist
  - Returns array of successfully added tags

- **get_entities_by_tag**

  - Find entities with a specific tag
  - Input: `tagName` (string)
  - Returns entities and their relations that have the specified tag

- **get_all_tags**

  - List all available tags
  - No input required
  - Returns all tags with their categories and descriptions

- **get_tag_usage**

  - Get usage statistics for tags
  - No input required
  - Returns tag usage counts for entities and observations

- **remove_tags_from_entity**
  - Remove specific tags from an entity
  - Input: `entityName` (string), `tagNames` (string[])
  - Returns array of successfully removed tags

## Usage

### Setup

Add this to your mcp server config:

#### NPX

```json
{
  "mcpServers": {
    "knowledge-graph": {
      "command": "npx",
      "args": ["-y", "@deanacus/knowledge-graph-mcp", "/path/to/your/knowledge-graph.db"]
    }
  }
}
```

The database file will be created automatically if it doesn't exist. Choose a location where you
want to persistently store your knowledge graph data.

### VS Code Configuration

Optionally, you can add it to a file called `.vscode/mcp.json` in your workspace. This will allow
you to share the configuration with others.

> Note that the `mcp` key is not needed in the `.vscode/mcp.json` file.

```json
{
  "servers": {
    "knowledge-graph": {
      "command": "npx",
      "args": ["-y", "@deanacus/knowledge-graph-mcp", "/path/to/your/knowledge-graph.db"]
    }
  }
}
```

### Usage Examples

#### Basic Entity and Relation Management

```javascript
// Create entities
await create_entities({
  entities: [
    {
      name: 'John_Smith',
      entityType: 'person',
      observations: ['Senior developer', 'Works remotely'],
    },
  ],
});

// Add tags to organize information
await tag_entity({
  entityName: 'John_Smith',
  tagNames: ['team-member', 'senior', 'remote-worker'],
});

// Tag specific observations
await tag_observation({
  entityName: 'John_Smith',
  observationContent: 'Works remotely',
  tagNames: ['work-style', 'post-covid'],
});
```

#### Discovery and Organization

```javascript
// Find all team members
await get_entities_by_tag({ tagName: 'team-member' });

// Get all available tags to understand the knowledge graph structure
await get_all_tags();

// See which tags are most commonly used
await get_tag_usage();
```

### System Prompt

The prompt for utilizing memory depends on the use case. Changing the prompt will help the model
determine the frequency and types of memories created.

Here is an example prompt for project context management with tagging.

```
Follow these steps for each interaction:

1. Project Context Identification:
   - Identify the current project or codebase you are working with
   - If project context is unclear, ask clarifying questions about the project scope and purpose

2. Memory Retrieval:
   - Always begin your chat by saying only "Remembering..." and retrieve all relevant project information from your knowledge graph
   - Use tags to filter relevant information for the current context (e.g., current project, specific features)
   - Always refer to your knowledge graph as your "project memory"

3. Project Information Organization:
   - Use tags to organize information by:
     a) Project phases (e.g., "planning", "development", "testing", "deployed")
     b) Components (e.g., "frontend", "backend", "database", "auth")
     c) Priority levels (e.g., "critical", "high-priority", "nice-to-have")
     d) Status (e.g., "completed", "in-progress", "blocked", "deprecated")
     e) People and roles (e.g., "stakeholder", "developer", "user")

4. Information Capture:
   - Continuously build understanding of the project by capturing any relevant information discovered during our work together
   - Be comprehensive in what you consider worth remembering - technical details, context, decisions, patterns, constraints, or any insights that could be valuable later

5. Memory Update:
   - If any new project information was discovered during the interaction, update your memory as follows:
     a) Create entities for items you deem worthwhile, particularly components, modules, classes, functions, key concepts, and tasks
     b) Connect them using relations to show dependencies, inheritance, or workflows
     c) Store technical details, decisions, and context as observations
     d) Apply relevant tags to entities and observations for easy discovery and organization
     e) Use consistent tag naming conventions (e.g., kebab-case like "high-priority", "in-progress")

6. Context Switching:
   - When switching between different aspects of the project, use tags to filter your memory retrieval
   - Example: "Remembering frontend components..." then retrieve entities tagged with "frontend"
```

## Building

```sh
npm run build
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and
distribute the software, subject to the terms and conditions of the MIT License. For more details,
please see the LICENSE file in the project repository.

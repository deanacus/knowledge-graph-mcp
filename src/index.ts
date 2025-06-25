#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as kuzu from 'kuzu';

// Get database path from command line argument
const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: mcp-server-memory <database-path>');
  process.exit(1);
}

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  tags?: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface Observation {
  content: string;
  tags?: string[];
}

interface Tag {
  name: string;
  category?: string;
  description?: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
  tags?: Tag[];
}

// Helper function to handle QueryResult | QueryResult[] return type
function getSingleResult(result: kuzu.QueryResult | kuzu.QueryResult[]): kuzu.QueryResult {
  return Array.isArray(result) ? result[0] : result;
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private db: kuzu.Database;
  private conn: kuzu.Connection;

  constructor(dbPath: string) {
    this.db = new kuzu.Database(dbPath);
    this.conn = new kuzu.Connection(this.db);
  }

  async initialize(): Promise<void> {
    try {
      // Create Entity node table
      await this.conn.query(`
        CREATE NODE TABLE IF NOT EXISTS Entity(
          name STRING,
          entityType STRING,
          PRIMARY KEY(name)
        )
      `); // Create Observation node table

      await this.conn.query(`
        CREATE NODE TABLE IF NOT EXISTS Observation(
          id SERIAL,
          content STRING,
          PRIMARY KEY(id)
        )
      `); // Create Tag node table

      await this.conn.query(`
        CREATE NODE TABLE IF NOT EXISTS Tag(
          name STRING,
          category STRING,
          description STRING,
          PRIMARY KEY(name)
        )
      `); // Create HAS_OBSERVATION relationship

      await this.conn.query(`
        CREATE REL TABLE IF NOT EXISTS HAS_OBSERVATION(
          FROM Entity TO Observation
        )
      `); // Create RELATED_TO relationship

      await this.conn.query(`
        CREATE REL TABLE IF NOT EXISTS RELATED_TO(
          FROM Entity TO Entity,
          relationType STRING
        )
      `); // Create TAGGED_WITH relationships for entities

      await this.conn.query(`
        CREATE REL TABLE IF NOT EXISTS ENTITY_TAGGED_WITH(
          FROM Entity TO Tag
        )
      `); // Create TAGGED_WITH relationships for observations

      await this.conn.query(`
        CREATE REL TABLE IF NOT EXISTS OBSERVATION_TAGGED_WITH(
          FROM Observation TO Tag
        )
      `);
    } catch (error) {
      console.error('Error initializing schema:', error);
      throw error;
    }
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    const newEntities: Entity[] = [];

    for (const entity of entities) {
      try {
        // Check if entity already exists using prepared statement
        const checkStmt = await this.conn.prepare(`MATCH (e:Entity {name: $name}) RETURN e.name`);
        const existsResult = await this.conn.execute(checkStmt, { name: entity.name });

        if (getSingleResult(existsResult).getNumTuples() === 0) {
          // Create entity using prepared statement
          const createStmt = await this.conn.prepare(
            `CREATE (e:Entity {name: $name, entityType: $entityType})`,
          );
          await this.conn.execute(createStmt, { name: entity.name, entityType: entity.entityType }); // Add observations

          for (const observation of entity.observations) {
            const createObsStmt = await this.conn.prepare(
              `CREATE (o:Observation {content: $content})`,
            );
            await this.conn.execute(createObsStmt, { content: observation });

            const linkStmt = await this.conn
              .prepare(`MATCH (e:Entity {name: $entityName}), (o:Observation {content: $content})
               CREATE (e)-[:HAS_OBSERVATION]->(o)`);
            await this.conn.execute(linkStmt, { entityName: entity.name, content: observation });
          } // Add tags if provided

          if (entity.tags && entity.tags.length > 0) {
            for (const tagName of entity.tags) {
              // Create tag if it doesn't exist
              const checkTagStmt = await this.conn.prepare(
                `MATCH (t:Tag {name: $name}) RETURN t.name`,
              );
              const tagExists = await this.conn.execute(checkTagStmt, { name: tagName });

              if (getSingleResult(tagExists).getNumTuples() === 0) {
                const createTagStmt = await this.conn.prepare(
                  `CREATE (t:Tag {name: $name, category: '', description: ''})`,
                );
                await this.conn.execute(createTagStmt, { name: tagName });
              } // Link entity to tag

              const linkTagStmt = await this.conn
                .prepare(`MATCH (e:Entity {name: $entityName}), (t:Tag {name: $tagName})
                 CREATE (e)-[:ENTITY_TAGGED_WITH]->(t)`);
              await this.conn.execute(linkTagStmt, { entityName: entity.name, tagName });
            }
          } // Add the entity as successfully created

          newEntities.push({
            name: entity.name,
            entityType: entity.entityType,
            observations: entity.observations,
            tags: entity.tags || [],
          });
        }
      } catch (error) {
        console.error(`Error creating entity ${entity.name}:`, error);
        throw error; // Re-throw to surface the actual error
      }
    }

    return newEntities;
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    const newRelations: Relation[] = [];

    for (const relation of relations) {
      try {
        // Check if relation already exists using prepared statement
        const checkStmt = await this.conn
          .prepare(`MATCH (e1:Entity {name: $from})-[r:RELATED_TO {relationType: $relationType}]->(e2:Entity {name: $to})
           RETURN r`);
        const existsResult = await this.conn.execute(checkStmt, {
          from: relation.from,
          to: relation.to,
          relationType: relation.relationType,
        });

        if (getSingleResult(existsResult).getNumTuples() === 0) {
          const createStmt = await this.conn
            .prepare(`MATCH (e1:Entity {name: $from}), (e2:Entity {name: $to})
             CREATE (e1)-[:RELATED_TO {relationType: $relationType}]->(e2)`);
          await this.conn.execute(createStmt, {
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType,
          });

          newRelations.push({
            from: relation.from,
            to: relation.to,
            relationType: relation.relationType,
          });
        }
      } catch (error) {
        console.error(`Error creating relation ${relation.from} -> ${relation.to}:`, error);
        throw error; // Re-throw to surface the actual error
      }
    }

    return newRelations;
  }

  async addObservations(
    observations: { entityName: string; contents: string[] }[],
  ): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const results: { entityName: string; addedObservations: string[] }[] = [];

    for (const obs of observations) {
      try {
        const addedObservations: string[] = [];
        const escapedEntityName = obs.entityName.replace(/'/g, "\\'"); // Check if entity exists

        const entityResult = await this.conn.query(
          `MATCH (e:Entity {name: '${escapedEntityName}'}) RETURN e.name`,
        );

        if (getSingleResult(entityResult).getNumTuples() === 0) {
          throw new Error(`Entity with name ${obs.entityName} not found`);
        }

        for (const content of obs.contents) {
          try {
            const escapedContent = content.replace(/'/g, "\\'"); // Check if observation already exists for this entity

            const existsResult = await this.conn
              .query(`MATCH (e:Entity {name: '${escapedEntityName}'})-[:HAS_OBSERVATION]->(o:Observation {content: '${escapedContent}'})
               RETURN o`);

            if (getSingleResult(existsResult).getNumTuples() === 0) {
              // Create observation and link it
              await this.conn.query(`CREATE (o:Observation {content: '${escapedContent}'})`);

              await this.conn
                .query(`MATCH (e:Entity {name: '${escapedEntityName}'}), (o:Observation {content: '${escapedContent}'})
                 WHERE NOT (e)-[:HAS_OBSERVATION]->(o)
                 CREATE (e)-[:HAS_OBSERVATION]->(o)`);

              addedObservations.push(content);
            }
          } catch (error) {
            console.error(`Error adding observation ${content} to ${obs.entityName}:`, error);
          }
        }

        results.push({ entityName: obs.entityName, addedObservations });
      } catch (error) {
        console.error(`Error processing observations for entity ${obs.entityName}:`, error);
        throw error;
      }
    }

    return results;
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    for (const entityName of entityNames) {
      try {
        const escapedName = entityName.replace(/'/g, "\\'"); // Use DETACH DELETE to remove the entity and all its relationships

        await this.conn.query(`MATCH (e:Entity {name: '${escapedName}'})
           DETACH DELETE e`); // Also delete any orphaned observations that were connected to this entity

        await this.conn.query(`MATCH (o:Observation)
           WHERE NOT (o)<-[:HAS_OBSERVATION]-()
           DELETE o`);
      } catch (error) {
        console.error(`Error deleting entity ${entityName}:`, error);
      }
    }
  }

  async deleteObservations(
    deletions: { entityName: string; observations: string[] }[],
  ): Promise<void> {
    for (const deletion of deletions) {
      for (const observation of deletion.observations) {
        try {
          const escapedEntityName = deletion.entityName.replace(/'/g, "\\'");
          const escapedObservation = observation.replace(/'/g, "\\'"); // Use DETACH DELETE to remove the observation and its relationships

          await this.conn
            .query(`MATCH (e:Entity {name: '${escapedEntityName}'})-[:HAS_OBSERVATION]->(o:Observation {content: '${escapedObservation}'})
             DETACH DELETE o`);
        } catch (error) {
          console.error(
            `Error deleting observation ${observation} from ${deletion.entityName}:`,
            error,
          );
        }
      }
    }
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    for (const relation of relations) {
      try {
        const escapedFrom = relation.from.replace(/'/g, "\\'");
        const escapedTo = relation.to.replace(/'/g, "\\'");
        const escapedType = relation.relationType.replace(/'/g, "\\'");

        await this.conn
          .query(`MATCH (e1:Entity {name: '${escapedFrom}'})-[r:RELATED_TO {relationType: '${escapedType}'}]->(e2:Entity {name: '${escapedTo}'})
           DELETE r`);
      } catch (error) {
        console.error(`Error deleting relation ${relation.from} -> ${relation.to}:`, error);
      }
    }
  }

  async readGraph(): Promise<KnowledgeGraph> {
    try {
      // Get all entities with their observations and tags
      const entitiesResult = await this.conn.query(`
        MATCH (e:Entity)
        OPTIONAL MATCH (e)-[:HAS_OBSERVATION]->(o:Observation)
        OPTIONAL MATCH (e)-[:ENTITY_TAGGED_WITH]->(et:Tag)
        RETURN e.name AS name, e.entityType AS entityType,
               COLLECT(DISTINCT o.content) AS observations,
               COLLECT(DISTINCT et.name) AS tags
      `);

      const entities: Entity[] = [];
      const rows = await getSingleResult(entitiesResult).getAll();
      console.error(`Found ${rows.length} entities in readGraph`);

      for (const row of rows) {
        entities.push({
          name: row.name as string,
          entityType: row.entityType as string,
          observations:
            (row.observations as string[])?.filter((obs) => obs !== null && obs !== undefined) ||
            [],
          tags: (row.tags as string[])?.filter((tag) => tag !== null && tag !== undefined) || [],
        });
      } // Get all relations

      const relationsResult = await this.conn.query(`
        MATCH (e1:Entity)-[r:RELATED_TO]->(e2:Entity)
        RETURN e1.name AS from, e2.name AS to, r.relationType AS relationType
      `);

      const relations: Relation[] = [];
      const relationRows = await getSingleResult(relationsResult).getAll();
      console.error(`Found ${relationRows.length} relations in readGraph`);

      for (const row of relationRows) {
        relations.push({
          from: row.from as string,
          to: row.to as string,
          relationType: row.relationType as string,
        });
      } // Get all tags

      const tags = await this.getAllTags();
      console.error(`Found ${tags.length} tags in readGraph`);

      return { entities, relations, tags };
    } catch (error) {
      console.error('Error in readGraph:', error);
      throw error;
    }
  }

  async searchNodes(query: string): Promise<KnowledgeGraph> {
    try {
      const lowerQuery = query.toLowerCase();
      const escapedQuery = lowerQuery.replace(/'/g, "\\'"); // Search entities by name, type, or observations

      const entitiesResult = await this.conn.query(`
        MATCH (e:Entity)
        OPTIONAL MATCH (e)-[:HAS_OBSERVATION]->(o:Observation)
        WHERE LOWER(e.name) CONTAINS '${escapedQuery}'
           OR LOWER(e.entityType) CONTAINS '${escapedQuery}'
           OR LOWER(o.content) CONTAINS '${escapedQuery}'
        WITH e, COLLECT(DISTINCT o.content) AS observations
        RETURN DISTINCT e.name AS name, e.entityType AS entityType, observations
      `);

      const entities: Entity[] = [];
      const entityNames = new Set<string>();

      const rows = await getSingleResult(entitiesResult).getAll();
      for (const row of rows) {
        const entityName = row.name as string;
        const rawObservations = row.observations as string[] | null;
        entities.push({
          name: entityName,
          entityType: row.entityType as string,
          observations: rawObservations
            ? rawObservations.filter((obs) => obs !== null && obs !== '')
            : [],
        });
        entityNames.add(entityName);
      } // Get relations between filtered entities

      const relations: Relation[] = [];
      if (entityNames.size > 0) {
        const namesArray = Array.from(entityNames);
        const escapedNames = namesArray.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(', ');

        const relationsResult = await this.conn.query(`
          MATCH (e1:Entity)-[r:RELATED_TO]->(e2:Entity)
          WHERE e1.name IN [${escapedNames}] AND e2.name IN [${escapedNames}]
          RETURN e1.name AS from, e2.name AS to, r.relationType AS relationType
        `);

        const relationRows = await getSingleResult(relationsResult).getAll();
        for (const row of relationRows) {
          relations.push({
            from: row.from as string,
            to: row.to as string,
            relationType: row.relationType as string,
          });
        }
      }

      return { entities, relations };
    } catch (error) {
      console.error('Error in searchNodes:', error);
      throw error;
    }
  }

  async openNodes(names: string[]): Promise<KnowledgeGraph> {
    try {
      const escapedNames = names.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(', '); // Get specified entities with their observations

      const entitiesResult = await this.conn.query(`
        MATCH (e:Entity)
        WHERE e.name IN [${escapedNames}]
        OPTIONAL MATCH (e)-[:HAS_OBSERVATION]->(o:Observation)
        RETURN e.name AS name, e.entityType AS entityType, COLLECT(o.content) AS observations
      `);

      const entities: Entity[] = [];
      const rows = await getSingleResult(entitiesResult).getAll();
      for (const row of rows) {
        entities.push({
          name: row.name as string,
          entityType: row.entityType as string,
          observations: (row.observations as string[]).filter((obs) => obs !== null),
        });
      } // Get relations between specified entities

      const relationsResult = await this.conn.query(`
        MATCH (e1:Entity)-[r:RELATED_TO]->(e2:Entity)
        WHERE e1.name IN [${escapedNames}] AND e2.name IN [${escapedNames}]
        RETURN e1.name AS from, e2.name AS to, r.relationType AS relationType
      `);

      const relations: Relation[] = [];
      const relationRows = await getSingleResult(relationsResult).getAll();
      for (const row of relationRows) {
        relations.push({
          from: row.from as string,
          to: row.to as string,
          relationType: row.relationType as string,
        });
      }

      return { entities, relations };
    } catch (error) {
      console.error('Error in openNodes:', error);
      throw error;
    }
  }

  async createTags(tags: Tag[]): Promise<Tag[]> {
    const newTags: Tag[] = [];

    for (const tag of tags) {
      try {
        const escapedName = tag.name.replace(/'/g, "\\'"); // Check if tag already exists

        const existsResult = await this.conn.query(
          `MATCH (t:Tag {name: '${escapedName}'}) RETURN t.name`,
        );

        if (getSingleResult(existsResult).getNumTuples() === 0) {
          const escapedCategory = (tag.category || '').replace(/'/g, "\\'");
          const escapedDescription = (tag.description || '').replace(/'/g, "\\'"); // Create tag

          await this.conn.query(
            `CREATE (t:Tag {name: '${escapedName}', category: '${escapedCategory}', description: '${escapedDescription}'})`,
          );

          newTags.push({
            name: tag.name,
            category: tag.category,
            description: tag.description,
          });
        }
      } catch (error) {
        console.error(`Error creating tag ${tag.name}:`, error);
        throw error; // Re-throw to surface the actual error
      }
    }

    return newTags;
  }

  async tagEntity(entityName: string, tagNames: string[]): Promise<string[]> {
    const addedTags: string[] = [];

    try {
      const escapedEntityName = entityName.replace(/'/g, "\\'"); // Check if entity exists

      const entityResult = await this.conn.query(
        `MATCH (e:Entity {name: '${escapedEntityName}'}) RETURN e.name`,
      );

      if (getSingleResult(entityResult).getNumTuples() === 0) {
        throw new Error(`Entity with name ${entityName} not found`);
      }

      for (const tagName of tagNames) {
        try {
          const escapedTagName = tagName.replace(/'/g, "\\'"); // Check if tag exists, create if not

          const tagResult = await this.conn.query(
            `MATCH (t:Tag {name: '${escapedTagName}'}) RETURN t.name`,
          );

          if (getSingleResult(tagResult).getNumTuples() === 0) {
            await this.conn.query(
              `CREATE (t:Tag {name: '${escapedTagName}', category: '', description: ''})`,
            );
          } // Check if relationship already exists

          const relationExists = await this.conn.query(
            `MATCH (e:Entity {name: '${escapedEntityName}'})-[:ENTITY_TAGGED_WITH]->(t:Tag {name: '${escapedTagName}'}) RETURN e`,
          );

          if (getSingleResult(relationExists).getNumTuples() === 0) {
            // Create the tagging relationship
            await this.conn
              .query(`MATCH (e:Entity {name: '${escapedEntityName}'}), (t:Tag {name: '${escapedTagName}'})
               CREATE (e)-[:ENTITY_TAGGED_WITH]->(t)`);

            addedTags.push(tagName);
          }
        } catch (error) {
          console.error(`Error tagging entity ${entityName} with ${tagName}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error in tagEntity for ${entityName}:`, error);
      throw error;
    }

    return addedTags;
  }

  async tagObservation(
    entityName: string,
    observationContent: string,
    tagNames: string[],
  ): Promise<string[]> {
    const addedTags: string[] = [];

    try {
      const escapedEntityName = entityName.replace(/'/g, "\\'");
      const escapedContent = observationContent.replace(/'/g, "\\'");

      for (const tagName of tagNames) {
        try {
          const escapedTagName = tagName.replace(/'/g, "\\'"); // Check if tag exists, create if not

          const tagResult = await this.conn.query(
            `MATCH (t:Tag {name: '${escapedTagName}'}) RETURN t.name`,
          );

          if (getSingleResult(tagResult).getNumTuples() === 0) {
            await this.conn.query(
              `CREATE (t:Tag {name: '${escapedTagName}', category: '', description: ''})`,
            );
          } // Find the observation and create relationship if it doesn't exist

          const relationExists = await this.conn
            .query(`MATCH (e:Entity {name: '${escapedEntityName}'})-[:HAS_OBSERVATION]->(o:Observation {content: '${escapedContent}'})-[:OBSERVATION_TAGGED_WITH]->(t:Tag {name: '${escapedTagName}'})
             RETURN o`);

          if (getSingleResult(relationExists).getNumTuples() === 0) {
            await this.conn
              .query(`MATCH (e:Entity {name: '${escapedEntityName}'})-[:HAS_OBSERVATION]->(o:Observation {content: '${escapedContent}'}), (t:Tag {name: '${escapedTagName}'})
               CREATE (o)-[:OBSERVATION_TAGGED_WITH]->(t)`);

            addedTags.push(tagName);
          }
        } catch (error) {
          console.error(`Error tagging observation with ${tagName}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error in tagObservation:`, error);
      throw error;
    }

    return addedTags;
  }

  async getEntitiesByTag(tagName: string): Promise<KnowledgeGraph> {
    try {
      const escapedTagName = tagName.replace(/'/g, "\\'"); // Get entities with the specified tag (simplified query to avoid nested aggregation)

      const entitiesResult = await this.conn.query(`
        MATCH (e:Entity)-[:ENTITY_TAGGED_WITH]->(t:Tag {name: '${escapedTagName}'})
        OPTIONAL MATCH (e)-[:HAS_OBSERVATION]->(o:Observation)
        RETURN e.name AS name, e.entityType AS entityType,
               COLLECT(DISTINCT o.content) AS observations,
               COLLECT(DISTINCT t.name) AS entityTags
      `);

      const entities: Entity[] = [];
      const rows = await getSingleResult(entitiesResult).getAll();
      for (const row of rows) {
        const rawObservations = row.observations as string[] | null;
        const rawTags = row.entityTags as string[] | null;
        entities.push({
          name: row.name as string,
          entityType: row.entityType as string,
          observations: rawObservations
            ? rawObservations.filter((obs) => obs !== null && obs !== '')
            : [],
          tags: rawTags ? rawTags.filter((tag) => tag !== null && tag !== '') : [],
        });
      } // Get relations between these entities

      const entityNames = entities.map((e) => e.name);
      const relations: Relation[] = [];

      if (entityNames.length > 0) {
        const escapedNames = entityNames.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(', ');

        const relationsResult = await this.conn.query(`
          MATCH (e1:Entity)-[r:RELATED_TO]->(e2:Entity)
          WHERE e1.name IN [${escapedNames}] AND e2.name IN [${escapedNames}]
          RETURN e1.name AS from, e2.name AS to, r.relationType AS relationType
        `);

        const relationRows = await getSingleResult(relationsResult).getAll();
        for (const row of relationRows) {
          relations.push({
            from: row.from as string,
            to: row.to as string,
            relationType: row.relationType as string,
          });
        }
      }

      return { entities, relations };
    } catch (error) {
      console.error(`Error in getEntitiesByTag for tag ${tagName}:`, error);
      throw error;
    }
  }

  async getAllTags(): Promise<Tag[]> {
    const tagsResult = await this.conn.query(`
      MATCH (t:Tag)
      RETURN t.name AS name, t.category AS category, t.description AS description
      ORDER BY t.name
    `);

    const tags: Tag[] = [];
    const rows = await getSingleResult(tagsResult).getAll();
    for (const row of rows) {
      tags.push({
        name: row.name as string,
        category: row.category === '' ? undefined : (row.category as string),
        description: row.description === '' ? undefined : (row.description as string),
      });
    }

    return tags;
  }

  async getTagUsage(): Promise<{ tag: string; entityCount: number; observationCount: number }[]> {
    const usageResult = await this.conn.query(`
      MATCH (t:Tag)
      OPTIONAL MATCH (e:Entity)-[:ENTITY_TAGGED_WITH]->(t)
      OPTIONAL MATCH (o:Observation)-[:OBSERVATION_TAGGED_WITH]->(t)
      RETURN t.name AS tag,
             COUNT(DISTINCT e) AS entityCount,
             COUNT(DISTINCT o) AS observationCount
      ORDER BY entityCount + observationCount DESC
    `);

    const usage: { tag: string; entityCount: number; observationCount: number }[] = [];
    const rows = await getSingleResult(usageResult).getAll();
    for (const row of rows) {
      usage.push({
        tag: row.tag as string,
        entityCount: row.entityCount as number,
        observationCount: row.observationCount as number,
      });
    }

    return usage;
  }

  async removeTagsFromEntity(entityName: string, tagNames: string[]): Promise<string[]> {
    const removedTags: string[] = [];
    const escapedEntityName = entityName.replace(/'/g, "\\'");

    for (const tagName of tagNames) {
      try {
        const escapedTagName = tagName.replace(/'/g, "\\'");

        const result = await this.conn
          .query(`MATCH (e:Entity {name: '${escapedEntityName}'})-[r:ENTITY_TAGGED_WITH]->(t:Tag {name: '${escapedTagName}'})
           DELETE r
           RETURN t.name AS removedTag`);

        if (getSingleResult(result).getNumTuples() > 0) {
          removedTags.push(tagName);
        }
      } catch (error) {
        console.error(`Error removing tag ${tagName} from entity ${entityName}:`, error);
      }
    }

    return removedTags;
  }

  close(): void {
    this.conn.close();
    this.db.close();
  }
}

const knowledgeGraphManager = new KnowledgeGraphManager(dbPath);

// The server instance and tools exposed to Claude
const server = new Server(
  {
    name: 'memory-server',
    version: '0.6.3',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'create_entities',
        description: 'Create multiple new entities in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            entities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'The name of the entity' },
                  entityType: { type: 'string', description: 'The type of the entity' },
                  observations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'An array of observation contents associated with the entity',
                  },
                },
                required: ['name', 'entityType', 'observations'],
              },
            },
          },
          required: ['entities'],
        },
      },
      {
        name: 'create_relations',
        description:
          'Create multiple new relations between entities in the knowledge graph. Relations should be in active voice',
        inputSchema: {
          type: 'object',
          properties: {
            relations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: {
                    type: 'string',
                    description: 'The name of the entity where the relation starts',
                  },
                  to: {
                    type: 'string',
                    description: 'The name of the entity where the relation ends',
                  },
                  relationType: { type: 'string', description: 'The type of the relation' },
                },
                required: ['from', 'to', 'relationType'],
              },
            },
          },
          required: ['relations'],
        },
      },
      {
        name: 'add_observations',
        description: 'Add new observations to existing entities in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            observations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entityName: {
                    type: 'string',
                    description: 'The name of the entity to add the observations to',
                  },
                  contents: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'An array of observation contents to add',
                  },
                },
                required: ['entityName', 'contents'],
              },
            },
          },
          required: ['observations'],
        },
      },
      {
        name: 'delete_entities',
        description:
          'Delete multiple entities and their associated relations from the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            entityNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'An array of entity names to delete',
            },
          },
          required: ['entityNames'],
        },
      },
      {
        name: 'delete_observations',
        description: 'Delete specific observations from entities in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            deletions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entityName: {
                    type: 'string',
                    description: 'The name of the entity containing the observations',
                  },
                  observations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'An array of observations to delete',
                  },
                },
                required: ['entityName', 'observations'],
              },
            },
          },
          required: ['deletions'],
        },
      },
      {
        name: 'delete_relations',
        description: 'Delete multiple relations from the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            relations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: {
                    type: 'string',
                    description: 'The name of the entity where the relation starts',
                  },
                  to: {
                    type: 'string',
                    description: 'The name of the entity where the relation ends',
                  },
                  relationType: { type: 'string', description: 'The type of the relation' },
                },
                required: ['from', 'to', 'relationType'],
              },
              description: 'An array of relations to delete',
            },
          },
          required: ['relations'],
        },
      },
      {
        name: 'read_graph',
        description: 'Read the entire knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'search_nodes',
        description: 'Search for nodes in the knowledge graph based on a query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'The search query to match against entity names, types, and observation content',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'open_nodes',
        description: 'Open specific nodes in the knowledge graph by their names',
        inputSchema: {
          type: 'object',
          properties: {
            names: {
              type: 'array',
              items: { type: 'string' },
              description: 'An array of entity names to retrieve',
            },
          },
          required: ['names'],
        },
      },
      {
        name: 'create_tags',
        description: 'Create new tags in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'The name of the tag' },
                  category: { type: 'string', description: 'The category of the tag' },
                  description: { type: 'string', description: 'The description of the tag' },
                },
                required: ['name'],
              },
            },
          },
          required: ['tags'],
        },
      },
      {
        name: 'tag_entity',
        description: 'Add tags to an entity',
        inputSchema: {
          type: 'object',
          properties: {
            entityName: {
              type: 'string',
              description: 'The name of the entity to tag',
            },
            tagNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'An array of tag names to add to the entity',
            },
          },
          required: ['entityName', 'tagNames'],
        },
      },
      {
        name: 'tag_observation',
        description: 'Add tags to an observation',
        inputSchema: {
          type: 'object',
          properties: {
            entityName: {
              type: 'string',
              description: 'The name of the entity containing the observation',
            },
            observationContent: {
              type: 'string',
              description: 'The content of the observation to tag',
            },
            tagNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'An array of tag names to add to the observation',
            },
          },
          required: ['entityName', 'observationContent', 'tagNames'],
        },
      },
      {
        name: 'get_entities_by_tag',
        description: 'Get entities that have a specific tag',
        inputSchema: {
          type: 'object',
          properties: {
            tagName: {
              type: 'string',
              description: 'The name of the tag to filter entities by',
            },
          },
          required: ['tagName'],
        },
      },
      {
        name: 'get_all_tags',
        description: 'Retrieve all tags in the knowledge graph',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_tag_usage',
        description: 'Get usage statistics for tags',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'remove_tags_from_entity',
        description: 'Remove tags from an entity',
        inputSchema: {
          type: 'object',
          properties: {
            entityName: {
              type: 'string',
              description: 'The name of the entity to remove tags from',
            },
            tagNames: {
              type: 'array',
              items: { type: 'string' },
              description: 'An array of tag names to remove from the entity',
            },
          },
          required: ['entityName', 'tagNames'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case 'create_entities':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.createEntities(args.entities as Entity[]),
              null,
              2,
            ),
          },
        ],
      };
    case 'create_relations':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.createRelations(args.relations as Relation[]),
              null,
              2,
            ),
          },
        ],
      };
    case 'add_observations':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.addObservations(
                args.observations as { entityName: string; contents: string[] }[],
              ),
              null,
              2,
            ),
          },
        ],
      };
    case 'delete_entities':
      await knowledgeGraphManager.deleteEntities(args.entityNames as string[]);
      return { content: [{ type: 'text', text: 'Entities deleted successfully' }] };
    case 'delete_observations':
      await knowledgeGraphManager.deleteObservations(
        args.deletions as { entityName: string; observations: string[] }[],
      );
      return { content: [{ type: 'text', text: 'Observations deleted successfully' }] };
    case 'delete_relations':
      await knowledgeGraphManager.deleteRelations(args.relations as Relation[]);
      return { content: [{ type: 'text', text: 'Relations deleted successfully' }] };
    case 'read_graph':
      return {
        content: [
          { type: 'text', text: JSON.stringify(await knowledgeGraphManager.readGraph(), null, 2) },
        ],
      };
    case 'search_nodes':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.searchNodes(args.query as string),
              null,
              2,
            ),
          },
        ],
      };
    case 'open_nodes':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.openNodes(args.names as string[]),
              null,
              2,
            ),
          },
        ],
      };
    case 'create_tags':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.createTags(args.tags as Tag[]),
              null,
              2,
            ),
          },
        ],
      };
    case 'tag_entity':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.tagEntity(
                args.entityName as string,
                args.tagNames as string[],
              ),
              null,
              2,
            ),
          },
        ],
      };
    case 'tag_observation':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.tagObservation(
                args.entityName as string,
                args.observationContent as string,
                args.tagNames as string[],
              ),
              null,
              2,
            ),
          },
        ],
      };
    case 'get_entities_by_tag':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.getEntitiesByTag(args.tagName as string),
              null,
              2,
            ),
          },
        ],
      };
    case 'get_all_tags':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(await knowledgeGraphManager.getAllTags(), null, 2),
          },
        ],
      };
    case 'get_tag_usage':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(await knowledgeGraphManager.getTagUsage(), null, 2),
          },
        ],
      };
    case 'remove_tags_from_entity':
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await knowledgeGraphManager.removeTagsFromEntity(
                args.entityName as string,
                args.tagNames as string[],
              ),
              null,
              2,
            ),
          },
        ],
      };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  // Initialize the database schema
  await knowledgeGraphManager.initialize();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Knowledge Graph MCP Server running on stdio'); // Handle graceful shutdown

  const cleanup = () => {
    knowledgeGraphManager.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  knowledgeGraphManager.close();
  process.exit(1);
});

declare module 'kuzu' {
  /**
   * Progress callback function type for query execution
   */
  export type ProgressCallback = (
    pipelineProgress: number,
    numPipelinesFinished: number,
    numPipelines: number,
  ) => void;
  /**
   * Generic data type for query results - can be primitives, objects, or arrays
   */

  export type KuzuValue =
    | null
    | boolean
    | number
    | string
    | Date
    | KuzuValue[]
    | { [key: string]: KuzuValue };
  /**
   * Query result row type - a plain object mapping column names to values
   */

  export type QueryResultRow = Record<string, KuzuValue>;
  /**
   * Parameter values for prepared statements
   */

  export type ParameterValue =
    | null
    | boolean
    | number
    | string
    | Date
    | ParameterValue[]
    | { [key: string]: ParameterValue };
  /**
   * Parameters object for prepared statements
   */

  export type Parameters = Record<string, ParameterValue>;
  /**
   * Database class for managing Kùzu database instances
   */

  export class Database {
    /**
     * Initialize a new Database object. Note that the initialization is done
     * lazily, so the database file is not opened until the first query is
     * executed. To initialize the database immediately, call the `init()`
     * function on the returned object.
     *
     * @param databasePath - Path to the database file. If the path is not specified,
     *                       or empty, or equal to ":memory:", the database will be
     *                       created in memory.
     * @param bufferManagerSize - Size of the buffer manager in bytes (default: 0)
     * @param enableCompression - Whether to enable compression (default: true)
     * @param readOnly - If true, database will be opened in read-only mode (default: false)
     * @param maxDBSize - Maximum size of the database file in bytes (default: 0)
     * @param autoCheckpoint - Whether to enable automatic checkpointing (default: true)
     * @param checkpointThreshold - Checkpoint threshold (default: -1)
     */
    constructor(
      databasePath?: string,
      bufferManagerSize?: number,
      enableCompression?: boolean,
      readOnly?: boolean,
      maxDBSize?: number,
      autoCheckpoint?: boolean,
      checkpointThreshold?: number,
    );
    /**
     * Get the version of the library.
     * @returns The version of the library
     */

    static getVersion(): string;
    /**
     * Get the storage version of the library.
     * @returns The storage version of the library
     */

    static getStorageVersion(): number;
    /**
     * Initialize the database. Calling this function is optional, as the
     * database is initialized automatically when the first query is executed.
     */

    init(): Promise<void>;
    /**
     * Initialize the database synchronously. Calling this function is optional, as the
     * database is initialized automatically when the first query is executed. This function
     * may block the main thread, so use it with caution.
     */

    initSync(): void;
    /**
     * Close the database.
     */

    close(): Promise<void>;
    /**
     * Close the database synchronously.
     * @throws Error if there is an ongoing asynchronous initialization
     */

    closeSync(): void;
  }
  /**
   * Connection class for executing queries against a Kùzu database
   */

  export class Connection {
    /**
     * Initialize a new Connection object. Note that the initialization is done
     * lazily, so the connection is not initialized until the first query is
     * executed. To initialize the connection immediately, call the `init()`
     * function on the returned object.
     *
     * @param database - The database object to connect to
     * @param numThreads - The maximum number of threads to use for query execution
     */
    constructor(database: Database, numThreads?: number);
    /**
     * Initialize the connection. Calling this function is optional, as the
     * connection is initialized automatically when the first query is executed.
     */

    init(): Promise<void>;
    /**
     * Initialize the connection synchronously. Calling this function is optional, as the
     * connection is initialized automatically when the first query is executed. This function
     * may block the main thread, so use it with caution.
     */

    initSync(): void;
    /**
     * Execute a query.
     * @param statement - The statement to execute
     * @param progressCallback - Optional callback function that is invoked with the progress
     *                          of the query execution
     * @returns A promise that resolves to the query result(s). Returns a single QueryResult
     *          if there's only one result, or an array of QueryResult objects for multiple results.
     */

    query(
      statement: string,
      progressCallback?: ProgressCallback,
    ): Promise<QueryResult | QueryResult[]>;
    /**
     * Execute a query synchronously.
     * @param statement - The statement to execute. This function blocks the main thread
     *                   for the duration of the query, so use it with caution.
     * @returns Query result(s). Returns a single QueryResult if there's only one result,
     *          or an array of QueryResult objects for multiple results.
     * @throws Error if there is an error
     */

    querySync(statement: string): QueryResult | QueryResult[];
    /**
     * Prepare a statement for execution.
     * @param statement - The statement to prepare
     * @returns A promise that resolves to the prepared statement
     */

    prepare(statement: string): Promise<PreparedStatement>;
    /**
     * Prepare a statement for execution synchronously. This function blocks the main thread
     * so use it with caution.
     * @param statement - The statement to prepare
     * @returns The prepared statement
     * @throws Error if there is an error
     */

    prepareSync(statement: string): PreparedStatement;
    /**
     * Execute a prepared statement with the given parameters.
     * @param preparedStatement - The prepared statement to execute
     * @param params - A plain object mapping parameter names to values
     * @param progressCallback - Optional callback function that is invoked with the progress
     *                          of the query execution
     * @returns A promise that resolves to the query result(s). Returns a single QueryResult
     *          if there's only one result, or an array of QueryResult objects for multiple results.
     */

    execute(
      preparedStatement: PreparedStatement,
      params?: Parameters,
      progressCallback?: ProgressCallback,
    ): Promise<QueryResult | QueryResult[]>;
    /**
     * Execute a prepared statement with the given parameters synchronously. This function
     * blocks the main thread for the duration of the query, so use it with caution.
     * @param preparedStatement - The prepared statement
     * @param params - A plain object mapping parameter names to values
     * @returns Query result(s). Returns a single QueryResult if there's only one result,
     *          or an array of QueryResult objects for multiple results.
     * @throws Error if there is an error
     */

    executeSync(
      preparedStatement: PreparedStatement,
      params?: Parameters,
    ): QueryResult | QueryResult[];
    /**
     * Set the maximum number of threads to use for query execution.
     * @param numThreads - The maximum number of threads to use for query execution
     */

    setMaxNumThreadForExec(numThreads: number): void;
    /**
     * Set the timeout for queries. Queries that take longer than the timeout
     * will be aborted.
     * @param timeoutInMs - The timeout in milliseconds
     */

    setQueryTimeout(timeoutInMs: number): void;
    /**
     * Close the connection.
     *
     * Note: Call to this method is optional. The connection will be closed
     * automatically when the object goes out of scope.
     */

    close(): Promise<void>;
    /**
     * Close the connection synchronously.
     * @throws Error if there is an ongoing asynchronous initialization
     */

    closeSync(): void;
  }
  /**
   * PreparedStatement class for prepared query statements
   */

  export class PreparedStatement {
    /**
     * Internal constructor. Use `Connection.prepare` to get a
     * `PreparedStatement` object.
     */
    constructor(connection: Connection, preparedStatement: any);
    /**
     * Check if the prepared statement is successfully prepared.
     * @returns True if the prepared statement is successfully prepared
     */

    isSuccess(): boolean;
    /**
     * Get the error message if the prepared statement is not successfully prepared.
     * @returns The error message
     */

    getErrorMessage(): string;
  }
  /**
   * QueryResult class for query results
   */

  export class QueryResult {
    /**
     * Internal constructor. Use `Connection.query` or `Connection.execute`
     * to get a `QueryResult` object.
     */
    constructor(connection: Connection, queryResult: any);
    /**
     * Reset the iterator of the query result to the beginning.
     * This function is useful if the query result is iterated multiple times.
     */

    resetIterator(): void;
    /**
     * Check if the query result has more rows.
     * @returns True if the query result has more rows
     */

    hasNext(): boolean;
    /**
     * Get the number of rows of the query result.
     * @returns The number of rows of the query result
     */

    getNumTuples(): number;
    /**
     * Get the next row of the query result.
     * @returns A promise that resolves to the next row of the query result
     */

    getNext(): Promise<QueryResultRow>;
    /**
     * Get the next row of the query result synchronously.
     * @returns The next row of the query result
     */

    getNextSync(): QueryResultRow;
    /**
     * Iterate through the query result with callback functions.
     * @param resultCallback - The callback function that is called for each row of the query result
     * @param doneCallback - The callback function that is called when the iteration is done
     * @param errorCallback - The callback function that is called when there is an error
     */

    each(
      resultCallback: (row: QueryResultRow) => void,
      doneCallback: () => void,
      errorCallback: (error: Error) => void,
    ): void;
    /**
     * Get all rows of the query result.
     * @returns A promise that resolves to all rows of the query result
     */

    getAll(): Promise<QueryResultRow[]>;
    /**
     * Get all rows of the query result synchronously. Note that this function can block
     * the main thread if the number of rows is large, so use it with caution.
     * @returns All rows of the query result
     */

    getAllSync(): QueryResultRow[];
    /**
     * Get all rows of the query result with callback functions.
     * @param resultCallback - The callback function that is called with all rows of the query result
     * @param errorCallback - The callback function that is called when there is an error
     */

    all(
      resultCallback: (rows: QueryResultRow[]) => void,
      errorCallback: (error: Error) => void,
    ): void;
    /**
     * Get the data types of the columns of the query result.
     * @returns A promise that resolves to the data types of the columns of the query result
     */

    getColumnDataTypes(): Promise<string[]>;
    /**
     * Get the data types of the columns of the query result synchronously.
     * @returns The data types of the columns of the query result
     */

    getColumnDataTypesSync(): string[];
    /**
     * Get the names of the columns of the query result.
     * @returns A promise that resolves to the names of the columns of the query result
     */

    getColumnNames(): Promise<string[]>;
    /**
     * Get the names of the columns of the query result synchronously.
     * @returns The names of the columns of the query result
     */

    getColumnNamesSync(): string[];
    /**
     * Close the query result.
     */

    close(): void;
  }
  /**
   * Main module exports
   */

  export const VERSION: string;
  export const STORAGE_VERSION: number; // Default export for CommonJS compatibility

  const kuzu: {
    Database: typeof Database;
    Connection: typeof Connection;
    PreparedStatement: typeof PreparedStatement;
    QueryResult: typeof QueryResult;
    VERSION: string;
    STORAGE_VERSION: number;
  };

  export default kuzu;
}

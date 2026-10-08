declare module 'better-sqlite3' {
  const Database: any;
  namespace Database {
    type Database = any;
    type Statement<T = any> = any;
    type Transaction<T = any> = any;
    type RunResult = any;
    type Options = any;
  }
  export default Database;
}

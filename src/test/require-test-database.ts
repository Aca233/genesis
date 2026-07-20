const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === "") {
  throw new Error("TEST_DATABASE_URL is required for integration tests");
}

process.env.DATABASE_URL = testDatabaseUrl;

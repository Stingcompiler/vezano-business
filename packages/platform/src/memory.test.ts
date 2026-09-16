import { MemoryStorage } from "./memory/index";
import { runStorageContractTests } from "./contract-tests/index";

runStorageContractTests("memory", () => Promise.resolve(new MemoryStorage()));

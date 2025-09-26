import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("AuthRegistryModule", (m) => {
  const authRegistry = m.contract("AuthRegistry");
  return { authRegistry };
});
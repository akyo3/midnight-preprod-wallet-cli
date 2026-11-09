// Preprod network endpoints and network ID.
// https://docs.midnight.network/relnotes/network#preprod
import { NetworkId } from "@midnight-ntwrk/wallet-sdk";
import { installLogRedaction } from "./logging";

export const NETWORK_ID = NetworkId.NetworkId.PreProd;

export function getNetworkConfig() {
  const blockfrostProjectId = process.env.BLOCKFROST_PROJECT_ID?.trim();
  if (!blockfrostProjectId) {
    throw new Error("BLOCKFROST_PROJECT_ID is not set in .env");
  }

  installLogRedaction(blockfrostProjectId);
  const projectId = `?project_id=${encodeURIComponent(blockfrostProjectId)}`;
  return {
    indexerHttpUrl: `https://midnight-preprod.blockfrost.io/api/v0${projectId}`,
    indexerWsUrl: `wss://midnight-preprod.blockfrost.io/api/v0/ws${projectId}`,
    node: `wss://rpc.midnight-preprod.blockfrost.io${projectId}`,
    proofServer: "http://localhost:6300",
  };
}

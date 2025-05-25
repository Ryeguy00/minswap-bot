import { BlockFrostAPI } from "@blockfrost/blockfrost-js";

import {
    Asset,
    BlockfrostAdapter,
    getBackendBlockfrostLucidInstance,
    NetworkId, StableOrder, Stableswap,
    StableswapCalculation,
    StableswapConstant,
} from "@minswap/sdk";
import 'dotenv/config';

import fs from 'fs';

function displayBalances(utxos: any) {
    if (!utxos || utxos.length === 0) {
        console.log("No UTXOs found at the address.");
        return;
    }

    const balances: { [unit: string]: bigint } = {};

    // Iterate through UTXOs and sum up asset quantities
    for (const utxo of utxos) {
        if (!utxo.assets || typeof utxo.assets !== "object") {
            console.warn("UTXO does not have a valid 'assets' property:", utxo);
            continue;
        }

        // Iterate through the assets object
        for (const [unit, quantity] of Object.entries(utxo.assets)) {
            if (!balances[unit]) {
                balances[unit] = BigInt(0);
            }
            balances[unit] += BigInt(quantity as number);
        }
    }

    // Display the balances
    console.log("Balances at address:");
    for (const [unit, quantity] of Object.entries(balances)) {
        console.log(`- ${unit}: ${quantity}`);
    }
}

async function stableswaplimitOrder() {
    const networkId: NetworkId = NetworkId.MAINNET;
    const blockfrostProjectId = process.env.MAIN_API as string;
    const blockfrostUrl = "https://cardano-mainnet.blockfrost.io/api/v0";

    const address = process.env.HW_ADDRESS as string;
    //const seed = process.env.MAIN_SEED as string;

    // USDC has 8 decimals, and DJED has 6 decimals.
    // 1 USDC = 100_000_000
    // 1 DJED = 1_000_000
    const USDC_AMOUNT = BigInt(100_000_000); // 1 USDC
    const DJED_AMOUNT = BigInt(1_000_000); // 1 DJED

    const lucid = await getBackendBlockfrostLucidInstance(
        networkId,
        blockfrostProjectId,
        blockfrostUrl,
        address
    );

    const blockfrostAdapter = new BlockfrostAdapter(
        networkId,
        new BlockFrostAPI({
            projectId: blockfrostProjectId,
            network: "mainnet",
        })
    );
    // This is LP asset of USDC-DJED pool.
    const lpAsset = Asset.fromString("ac49e0969d76ed5aa9e9861a77be65f4fc29e9a979dc4c37a99eb8f4555344432d444a45442d534c50");
    const config = StableswapConstant.getConfigByLpAsset(
        lpAsset,
        networkId
    );

    // Assume we're starting with DJED to USDC trade.
    var DJEDtoUSDC = true;
    var tradeAmount = 1;      // adjust this to change the starting swap amount

    // These will let us know which asset we are swapping in and out.
    var inIndex: number;
    var outIndex: number;

    const usdcIndex = 0;
    const djedIndex = 1;

    // Declare amountIn and amountOut
    var amountIn: bigint;
    var amountOut: bigint;

    // initialize variables based on the trade direction
    if (DJEDtoUSDC) {
        amountIn = BigInt(tradeAmount) * DJED_AMOUNT; // 500 DJED
        amountOut = BigInt(tradeAmount) * USDC_AMOUNT; // 500 USDC
        inIndex = djedIndex;
        outIndex = usdcIndex;
    } else {
        amountIn = BigInt(tradeAmount) * USDC_AMOUNT; // 500 USDC
        amountOut = BigInt(tradeAmount*1.01) * DJED_AMOUNT; // 505 DJED
        inIndex = usdcIndex;
        outIndex = djedIndex;
    }

    

    // Get my wallet UTXOs
    const utxos = await lucid.utxosAt(address);
    if (!utxos) {
        throw new Error("could not find utxos");
    }
    console.log("number of utxos: " + utxos.length);
    console.log("UTXO structure:", JSON.stringify(utxos, (key, value) =>
        typeof value === "bigint" ? value.toString() : value, 2));
    displayBalances(utxos);


    /* transaction creation */

    const txComplete = await new Stableswap(lucid).createBulkOrdersTx({
        sender: address,
        availableUtxos: utxos,
        options: [
            {
                lpAsset: lpAsset,
                type: StableOrder.StepType.SWAP,
                assetInAmount: amountIn,
                assetInIndex: BigInt(inIndex),
                assetOutIndex: BigInt(outIndex),
                minimumAssetOut: amountOut,
            },
        ],
    });

    // Save the raw transaction CBOR to a file
    const rawTxCbor = txComplete.toString(); // Get the CBOR string
    fs.writeFileSync('transaction.cbor', rawTxCbor); // Save it to a file
    console.log("Raw transaction CBOR saved to transaction.cbor");

    /*
    const signedTx = await txComplete
        .signWithSeed(seed, 0)
        .commit();
    console.log("signedTx txHash: " + signedTx.toHash());


    // Submit transaction
    const txId = await signedTx.submit();
    console.info(`Transaction submitted successfully: ${txId}`);
    console.log("Waiting for order to be processed...");
    */

}

void stableswaplimitOrder();

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('\nCaught SIGINT (Ctrl + C). Cleaning up...');
    process.exit(); // Exit the process cleanly
});
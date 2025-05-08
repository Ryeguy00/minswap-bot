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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stablePoolTradingBot() {
    const networkId: NetworkId = NetworkId.MAINNET;
    const blockfrostProjectId = process.env.MAIN_API as string;
    const blockfrostUrl = "https://cardano-mainnet.blockfrost.io/api/v0";

    const address = process.env.MAIN_ADDRESS as string;
    const seed = process.env.MAIN_SEED as string;

    // USDC has 8 decimals, and iUSD has 6 decimals.
    // 1 USDC = 100_000_000
    // 1 iUSD = 1_000_000
    const USDC_AMOUNT = BigInt(100_000_000); // 1 USDC
    const iUSD_AMOUNT = BigInt(1_000_000); // 1 iUSD

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
    // This is LP asset of USDC-iUSD pool.
    const lpAsset = Asset.fromString("48bee898de501ff287165fdfc5be34818f3a41e474ae8f47f8c59f7a555344432d695553442d302e312d534c50");
    const config = StableswapConstant.getConfigByLpAsset(
        lpAsset,
        networkId
    );

    // Assume we're starting with iUSD to USDC trade.
    var iUSDtoUSDC = true;
    var iUSDtoUSDCpriceTarget = 1.0 / 0.986; // 1000 iusd to 1014 usdc
    var USDCtoIUSDpriceTarget = 0.996;        // 1000 usdc to 996 iusd
    var tradeAmount = 100;      // adjust this to change the starting swap amount

    // Initialize amountIn and declare amountOut
    var amountIn = iUSDtoUSDC ? BigInt(tradeAmount) * iUSD_AMOUNT : BigInt(tradeAmount) * USDC_AMOUNT;
    var amountOut: bigint;

    // These will let us know which asset we are swapping in and out.
    var inIndex: number;
    var outIndex: number;

    const usdcIndex = 0;
    const iusdIndex = 1;

    // IDEA: initalize utxos here and then update them after submitting a transaction

    // Begin the trading bot loop
    while (true) {

        // Get my wallet UTXOs
        const utxos = await lucid.utxosAt(address);
        if (!utxos) {
            throw new Error("could not find utxos");
        }
        console.log("utxos length: " + utxos.length);
        for (let i = 0; i < utxos.length; i++) {
            console.log("utxos[" + i + "]: " + utxos[i]);
        }
        // IDEA: check if utxos contain enough iUSD or USDC to swap

        // initialize variables
        if (iUSDtoUSDC) {
            inIndex = iusdIndex;
            outIndex = usdcIndex;
        } else {
            inIndex = usdcIndex;
            outIndex = iusdIndex;
        }


        // This loop will run until we find a profitable trade.
        while (true) {
            // Show the current time
            console.log("\nTime: " + new Date().toLocaleTimeString());

            // Get the pool information from Blockfrost.
            const pool = await blockfrostAdapter.getStablePoolByLpAsset(lpAsset);
            if (!pool) {
                throw new Error("could not find pool");
            }

            // Calculate the amount out
            amountOut = StableswapCalculation.calculateSwapAmount({
                inIndex: inIndex,
                outIndex: outIndex,
                amountIn: amountIn,
                amp: pool.amp,
                multiples: config.multiples,
                datumBalances: pool.datum.balances,
                fee: config.fee,
                adminFee: config.adminFee,
                feeDenominator: config.feeDenominator,
            });
            //for testing logic below
            //amountOut = iUSDtoUSDC ? BigInt(1021) * USDC_AMOUNT : amountOut; // 1021 USDC

            // Calculate the current price
            var actualOut = iUSDtoUSDC ? (Number(amountOut) / Number(USDC_AMOUNT)) : (Number(amountOut) / Number(iUSD_AMOUNT));
            var actualIn = iUSDtoUSDC ? (Number(amountIn) / Number(iUSD_AMOUNT)) : (Number(amountIn) / Number(USDC_AMOUNT));
            var currentPrice = actualOut / actualIn;
            console.log("Current price:", currentPrice);

            // Check for profitability
            if (currentPrice > iUSDtoUSDCpriceTarget && iUSDtoUSDC) {
                console.log("iUSD to USDC trade is profitable. Continuing...");
                console.log("Attempting to swap", actualIn, "iUSD for", actualOut, "USDC");
                iUSDtoUSDC = false;

                // Set new amountIn for the next iteration
                amountIn = amountOut; // no need to multiply by USDC_AMOUNT again since amountOut is already in USDC
                break
            }
            else if (currentPrice > USDCtoIUSDpriceTarget && !iUSDtoUSDC) {
                console.log("USDC to iUSD trade is profitable. Continuing...");
                console.log("Attempting to swap", actualIn, "USDC for", actualOut, "iUSD");
                iUSDtoUSDC = true;

                // Set new amountIn for the next iteration
                amountIn = BigInt(tradeAmount) * iUSD_AMOUNT; // reset amountIn to the original trade amount
                console.log("amountIn:", Number(amountIn) / Number(iUSD_AMOUNT));
                break
            }
            else { // not profitable enough
                if (iUSDtoUSDC) {
                    console.log("amountIn:", Number(amountIn) / Number(iUSD_AMOUNT));
                    console.log("amountOut:", Number(amountOut) / Number(USDC_AMOUNT));
                }
                else {
                    console.log("amountIn:", Number(amountIn) / Number(USDC_AMOUNT));
                    console.log("amountOUt:", Number(amountOut) / Number(iUSD_AMOUNT));
                }
                console.log("Swap is not profitable enough. Waiting...");
            }
            await sleep(10 * 60 * 1000); // wait 10 minutes
        }

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

        const signedTx = await txComplete
            .signWithSeed(seed, 0)
            .commit();
        console.log("signedTx txHash: " + signedTx.toHash());


        // Submit transaction
        const txId = await signedTx.submit();
        console.info(`Transaction submitted successfully: ${txId}`);
        console.log("Waiting for order to be processed...");
        await sleep(10 * 60 * 1000); // wait 10 minutes for order to be processed

        //IDEA: update utxos here
        //      potentially check if order executed
        //      if not, cancel the order tx to get the tokens back
        //      or just wait for the order to be executed,
        //      and then continue the loop to find a new trade.
    }
}

void stablePoolTradingBot();

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('\nCaught SIGINT (Ctrl + C). Cleaning up...');
    process.exit(); // Exit the process cleanly
});
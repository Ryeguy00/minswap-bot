import {
    ADA,
    Asset,
    BlockfrostAdapter, calculateAmountWithSlippageTolerance, DexV2,
    DexV2Calculation,
    getBackendBlockfrostLucidInstance,
    NetworkId, OrderV2
} from "@minswap/sdk";
import {BlockFrostAPI} from "@blockfrost/blockfrost-js";
import 'dotenv/config';
import fs from 'fs';

async function dexV2trade() {
    const network: NetworkId = NetworkId.MAINNET;
    const blockfrostProjectId = process.env.MAIN_API as string;
    const blockfrostUrl = "https://cardano-mainnet.blockfrost.io/api/v0";

    const address = process.env.MAIN_ADDRESS as string;
    const seed = process.env.MAIN_SEED as string;

    const lucid = await getBackendBlockfrostLucidInstance(
        network,
        blockfrostProjectId,
        blockfrostUrl,
        address
    );

    const blockfrostAdapter = new BlockfrostAdapter(
        network,
        new BlockFrostAPI({
            projectId: blockfrostProjectId,
            network: "mainnet",
        })
    );

    const MIN: Asset = {
        policyId: "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6",
        tokenName: "4d494e",
    };

    const utxos = await lucid.utxosAt(address);

    const assetA = ADA;
    const assetB = MIN;

    const pool = await blockfrostAdapter.getV2PoolByPair(assetA, assetB);
    if (!pool) {
        throw new Error("could not find pool");
    }
    //console.log("pool", pool);
    //console.log("pool lpAsset", pool.lpAsset);

    const swapAmount = BigInt(1_000_000);
    const amountOut = DexV2Calculation.calculateAmountOut({
        reserveIn: pool.reserveA,
        reserveOut: pool.reserveB,
        amountIn: swapAmount,
        tradingFeeNumerator: pool.feeA[0],
    });

    // 20% slippage tolerance
    const acceptedAmountOut =
        calculateAmountWithSlippageTolerance({
            slippageTolerancePercent: 20,
            amount: amountOut,
            type: "down",
        });

    const txComplete = await new DexV2(
        lucid,
        blockfrostAdapter
    ).createBulkOrdersTx({
        sender: address,
        orderOptions: [
            {
                type: OrderV2.StepType.SWAP_EXACT_IN,
                amountIn: swapAmount,
                assetIn: assetA,
                direction: OrderV2.Direction.A_TO_B,
                minimumAmountOut: acceptedAmountOut,
                lpAsset: pool.lpAsset,
                isLimitOrder: false,
                killOnFailed: false,
            },
        ],
    });
    // Save the raw transaction CBOR to a file
    const rawTxCbor = txComplete.toString(); // Get the CBOR string
    fs.writeFileSync('transaction.cbor', rawTxCbor); // Save it to a file
    console.log("Raw transaction CBOR saved to transaction.cbor");

    /*
    // Uncomment this block to sign and submit the transaction  

    const signedTx = await txComplete
        .signWithSeed(seed, 0)
        .commit();

    const txId = await signedTx.submit();
    console.info(`Transaction submitted successfully: ${txId}`);
    */
}

void dexV2trade();

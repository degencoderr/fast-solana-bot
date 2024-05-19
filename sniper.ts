import { PublicKey, Keypair, Connection, ComputeBudgetProgram, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js'
import bs58 from 'bs58';
import { u8, struct, NearUInt64 } from "@solana/buffer-layout";
import { u64, publicKey } from "@solana/buffer-layout-utils";
import * as spl from "@solana/spl-token";


const connection = new Connection("YOUR_RPC_LINK")
const wallet = Keypair.fromSecretKey(bs58.decode("YOUR_PRIVATE_KEY"));
console.log(`Wallet Address: ${wallet.publicKey}`);
const raydiumKey = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')
const raydiumFees = new PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5");
const initLog = struct([u8('logType'), u64('openTime'), u8('quoteDecimals'), u8('baseDecimals'), u64('quoteLotSize'), u64('baseLotSize'), u64('quoteAmount'), u64('baseAmount'), publicKey('market') ]);

async function sniper() {
    console.log(`monitoring new solana tokens...`);
    try {
        connection.onLogs(raydiumFees, async (logObj) => {
            try {
              if (logObj.err) {
                console.error(`connection contains error, ${logObj.err}`);
                return;
              }
              console.log(`found new token signature: ${logObj.signature} Time: ${Date().toLocaleString()}`);
              for (const log of logObj["logs"]) {
                if (log.includes("ray_log")) {
                    const raydiumLogSplit = log.split(" ");
                    const raydiumLog = raydiumLogSplit[raydiumLogSplit.length - 1].replace("'", "");
                    const { market, baseDecimals, quoteDecimals, openTime } = initLog.decode(Buffer.from(raydiumLog, "base64"));
                    const PoolKeys = await assemblePoolKeys(market, baseDecimals, quoteDecimals);
                try {
                const tx = await buildSwap(PoolKeys, 100000, 0);
                const sent = await connection.sendTransaction(tx, [wallet], {skipPreflight: true})
                console.log("swapped in tx id:", sent)
                } catch(E) { console.log("Pool is not tradable Yet", openTime, Date.now()) } } } 
            } catch (error) {
              console.log(`error occured in new solana token log callback function, ${JSON.stringify(error, null, 2)}`);
            }
          },
          'confirmed'
        );
      } catch (error) {
        console.log(`error occured in new sol lp monitor, ${JSON.stringify(error, null, 2)}`);
      }
    }

    async function assemblePoolKeys(marketId, baseDecimals, quoteDecimals) {
        
        const getAta = async (mint, publicKey) => PublicKey.findProgramAddressSync([publicKey.toBuffer(), spl.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], spl.ASSOCIATED_TOKEN_PROGRAM_ID)[0];
        async function getMarketInfo(marketId) {
        let baseMint: PublicKey; 
        let quoteMint:  PublicKey;
        const info = await connection.getAccountInfo(marketId)
        const ownAddress = new PublicKey(info.data.slice(13, 45))
        const vaultSignerNonce = new NearUInt64().decode(new Uint8Array((info).data.subarray(45, 53)))
        baseMint = new PublicKey(info.data.slice(53, 85))
        if (baseMint.toString()==="So11111111111111111111111111111111111111112"){
            baseMint = new PublicKey(info.data.slice(85, 117));
           quoteMint = new PublicKey(info.data.slice(53, 85));
         }
         else{
            quoteMint = new PublicKey(info.data.slice(85, 117));
         }
        //const quoteMint = new PublicKey(info.data.slice(85, 117))
        const bids = new PublicKey(info.data.slice(285, 317))
        const asks = new PublicKey(info.data.slice(317, 349))
        const event = new PublicKey(info.data.slice(253, 285))
        const baseVault = new PublicKey(info.data.slice(117, 149))
        const quoteVault = new PublicKey(info.data.slice(165, 197))
        const marketInfo = {
        ownAddress,
        vaultSignerNonce,
        baseMint,
        quoteMint,
        bids,
        asks,
        event,
        baseVault,
        quoteVault}
        return(marketInfo)
        }
        const marketInfo = await getMarketInfo(marketId)
        const [baseMint, quoteMint] = [marketInfo.baseMint, marketInfo.quoteMint];
        const [ownerBaseAta, ownerQuoteAta] = await Promise.all([getAta(baseMint, wallet.publicKey), getAta(quoteMint, wallet.publicKey)]);
        const authority = PublicKey.findProgramAddressSync([Buffer.from([97, 109, 109, 32, 97, 117, 116, 104, 111, 114, 105, 116, 121])], ray)[0];
        const marketAuthority = PublicKey.createProgramAddressSync([marketId.toBuffer(), Buffer.from([Number(marketInfo.vaultSignerNonce.toString())]), Buffer.alloc(7)], new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'));
        const seeds = ['amm_associated_seed', 'coin_vault_associated_seed', 'pc_vault_associated_seed', 'lp_mint_associated_seed', 'temp_lp_token_associated_seed', 'target_associated_seed', 'withdraw_associated_seed', 'open_order_associated_seed', 'pc_vault_associated_seed'].map(seed => Buffer.from(seed, 'utf-8'));
        const [id, baseVault, coinVault, lpMint, lpVault, targetOrders, withdrawQueue, openOrders, quoteVault] = await Promise.all(seeds.map(seed => PublicKey.findProgramAddress([ray.toBuffer(), marketId.toBuffer(), seed], ray)));
        return({
            programId: raydiumKey,
            baseMint,
            quoteMint,
            ownerBaseAta,
            ownerQuoteAta,
            baseDecimals,
            quoteDecimals,
            tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            lpDecimals: baseDecimals,
            authority,
            marketAuthority,
            marketProgramId: new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX'),
            marketId,
            marketBids: marketInfo.bids,
            marketAsks: marketInfo.asks,
            marketQuoteVault: marketInfo.quoteVault,
            marketBaseVault: marketInfo.baseVault,
            marketEventQueue: marketInfo.event,
            id: id[0],
            baseVault: baseVault[0],
            coinVault: coinVault[0],
            lpMint: lpMint[0],
            lpVault: lpVault[0],
            targetOrders: targetOrders[0],
            withdrawQueue: withdrawQueue[0],
            openOrders: openOrders[0],
            quoteVault: quoteVault[0],
            lookupTableAccount: PublicKey.default,
            wallet: wallet.publicKey}
        )
    }
    async function buildSwap(PoolKeys, amountIn, minAmountOut) {
        const accountMetas = [
        {pubkey: PoolKeys.tokenProgram,     isSigner: false, isWritable: false},    // token program
        {pubkey: PoolKeys.id,               isSigner: false, isWritable: true},     // amm/pool id
        {pubkey: PoolKeys.authority,        isSigner: false, isWritable: false},    // amm/pool authority
        {pubkey: PoolKeys.openOrders,       isSigner: false, isWritable: true},     // amm/pool open orders
        {pubkey: PoolKeys.targetOrders,     isSigner: false, isWritable: true},     // amm/pool target orders
        {pubkey: PoolKeys.baseVault,        isSigner: false, isWritable: true},     // amm/pool baseVault/pool coin token account
        {pubkey: PoolKeys.quoteVault,       isSigner: false, isWritable: true},     // amm/pool quoteVault/pool pc token account
        {pubkey: PoolKeys.marketProgramId,  isSigner: false, isWritable: false},    // openbook program id
        {pubkey: PoolKeys.marketId,         isSigner: false, isWritable: true},     // openbook market
        {pubkey: PoolKeys.marketBids,       isSigner: false, isWritable: true},     // openbook bids
        {pubkey: PoolKeys.marketAsks,       isSigner: false, isWritable: true},     // openbook asks
        {pubkey: PoolKeys.marketEventQueue, isSigner: false, isWritable: true},     // openbook event queue
        {pubkey: PoolKeys.marketBaseVault,  isSigner: false, isWritable: true},     // marketBaseVault/openbook coin vault
        {pubkey: PoolKeys.marketQuoteVault, isSigner: false, isWritable: true},     // marketQuoteVault/openbook pc vault
        {pubkey: PoolKeys.marketAuthority,  isSigner: false, isWritable: false},    // marketAuthority/openbook vault signer
        {pubkey: PoolKeys.ownerQuoteAta,    isSigner: false, isWritable: true},     // wallet wsol account
        {pubkey: PoolKeys.ownerBaseAta,     isSigner: false, isWritable: true},     // wallet token account
        {pubkey: wallet.publicKey,      isSigner: true,  isWritable: true}]     // wallet pubkey
        const buffer = Buffer.alloc(16);
        new BN(amountIn).toArrayLike(Buffer, 'le', 8).copy(buffer, 0);
        new BN(minAmountOut).toArrayLike(Buffer, 'le', 8).copy(buffer, 8);
        const swap = new TransactionInstruction({ keys: accountMetas, programId: raydiumKey, data: Buffer.concat([Buffer.from([0x09]), buffer]) })
        const uPrice = ComputeBudgetProgram.setComputeUnitPrice({microLamports: 200000})
        const quoteAta = spl.createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, PoolKeys.ownerQuoteAta, wallet.publicKey, PoolKeys.quoteMint)
        const tokenAta = spl.createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, PoolKeys.ownerBaseAta, wallet.publicKey, PoolKeys.baseMint)
        const closeSol = spl.createCloseAccountInstruction(PoolKeys.ownerQuoteAta, wallet.publicKey, wallet.publicKey)
        const transaction = new Transaction()
        transaction.add(uPrice)
        transaction.add(quoteAta)
        transaction.add(SystemProgram.transfer({fromPubkey: wallet.publicKey, toPubkey: PoolKeys.ownerQuoteAta, lamports: amountIn }), spl.createSyncNativeInstruction(PoolKeys.ownerQuoteAta))
        transaction.add(tokenAta)
        transaction.add(swap)
        transaction.add(closeSol)
    return(transaction) 
}

sniper();
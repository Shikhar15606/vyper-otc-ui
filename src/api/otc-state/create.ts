/* eslint-disable space-before-function-paren */
import { AnchorProvider, BN, Program, utils } from '@project-serum/anchor';
import { getMint } from '@solana/spl-token';
import { Keypair, PublicKey, Signer, Transaction } from '@solana/web3.js';
import { OtcInitializationParams } from 'controllers/createContract/OtcInitializationParams';
import { RatePyth, IDL as RatePythIDL } from 'idls/rate_pyth';
import { RateSwitchboard, IDL as RateSwitchboardIDL } from 'idls/rate_switchboard';
import { RedeemLogicForward, IDL as RedeemLogicForwardIDL } from 'idls/redeem_logic_forward';
import { VyperCore, IDL as VyperCoreIDL } from 'idls/vyper_core';
import { VyperOtc, IDL as VyperOtcIDL } from 'idls/vyper_otc';
import { TxPackage } from 'models/TxPackage';

import PROGRAMS from '../../configs/programs.json';

export const create = async (provider: AnchorProvider, params: OtcInitializationParams): Promise<[TxPackage[], PublicKey]> => {
	const vyperOtcProgram = new Program<VyperOtc>(VyperOtcIDL, new PublicKey(PROGRAMS.VYPER_OTC_PROGRAM_ID), provider);
	const vyperCoreProgram = new Program<VyperCore>(VyperCoreIDL, new PublicKey(PROGRAMS.VYPER_CORE_PROGRAM_ID), provider);

	const reserveMintInfo = await getMint(provider.connection, params.reserveMint);

	const redeemLogicForwardProgram = new Program<RedeemLogicForward>(RedeemLogicForwardIDL, PROGRAMS.REDEEM_LOGIC_FORWARD_PROGRAM_ID, provider);

	const otcState = Keypair.generate();
	const [otcAuthority] = await PublicKey.findProgramAddress([otcState.publicKey.toBuffer(), utils.bytes.utf8.encode('authority')], vyperOtcProgram.programId);

	//  rate plugin init
	let rateProgramPublicKey: PublicKey = undefined;
	const ratePluginState = Keypair.generate();
	const vyperCoreInitTx = new Transaction();

	if (params.rateOption.ratePluginType === 'switchboard') {
		const rateSwitchboardProgram = new Program<RateSwitchboard>(RateSwitchboardIDL, new PublicKey(PROGRAMS.RATE_SWITCHBOARD_PROGRAM_ID), provider);
		const rateSwitchboardInitIX = await rateSwitchboardProgram.methods
			.initialize()
			.accounts({
				rateData: ratePluginState.publicKey
			})
			.remainingAccounts(
				[params.rateOption.rateAccount].map((c) => {
					return { pubkey: c, isSigner: false, isWritable: false };
				})
			)
			.signers([ratePluginState])
			.instruction();
		vyperCoreInitTx.add(rateSwitchboardInitIX);
		rateProgramPublicKey = rateSwitchboardProgram.programId;
	}

	if (params.rateOption.ratePluginType === 'pyth') {
		const ratePythProgram = new Program<RatePyth>(RatePythIDL, new PublicKey(PROGRAMS.RATE_PYTH_PROGRAM_ID), provider);

		const ratePythInitIX = await ratePythProgram.methods
			.initialize()
			.accounts({
				rateData: ratePluginState.publicKey
			})
			.remainingAccounts(
				[params.rateOption.rateAccount].map((c) => {
					return { pubkey: c, isSigner: false, isWritable: false };
				})
			)
			.signers([ratePluginState])
			.instruction();
		vyperCoreInitTx.add(ratePythInitIX);
		rateProgramPublicKey = ratePythProgram.programId;
	}

	const redeemLogicPluginState = Keypair.generate();
	const redeemLogicInixIX = await redeemLogicForwardProgram.methods
		.initialize(params.redeemLogicOption.strike, new BN(params.redeemLogicOption.notional * 10 ** reserveMintInfo.decimals), params.redeemLogicOption.isLinear)
		.accounts({
			redeemLogicConfig: redeemLogicPluginState.publicKey,
			owner: provider.wallet.publicKey,
			payer: provider.wallet.publicKey
		})
		.signers([redeemLogicPluginState])
		.instruction();

	vyperCoreInitTx.add(redeemLogicInixIX);

	const [vyperCoreTx, vyperCoreSigners, vyperConfig] = await createVyperCoreTrancheConfig(
		provider,
		vyperCoreProgram,
		params.reserveMint,
		rateProgramPublicKey,
		ratePluginState.publicKey,
		redeemLogicForwardProgram.programId,
		redeemLogicPluginState.publicKey,
		otcAuthority
	);

	vyperCoreInitTx.add(vyperCoreTx);

	const vyperCoreInitTxPackage: TxPackage = {
		tx: vyperCoreInitTx,
		description: 'Vyper Core init',
		signers: [ratePluginState, redeemLogicPluginState, ...vyperCoreSigners]
	};

	// accounts to create
	const otcSeniorReserveTokenAccount = Keypair.generate();
	const otcJuniorReserveTokenAccount = Keypair.generate();
	const otcSeniorTrancheTokenAccount = Keypair.generate();
	const otcJuniorTrancheTokenAccount = Keypair.generate();

	const otcInitTx: TxPackage = {
		tx: await vyperOtcProgram.methods
			.initialize({
				seniorDepositAmount: new BN(params.seniorDepositAmount * 10 ** reserveMintInfo.decimals),
				juniorDepositAmount: new BN(params.juniorDepositAmount * 10 ** reserveMintInfo.decimals),
				depositStart: new BN(params.depositStart / 1000),
				depositEnd: new BN(params.depositEnd / 1000),
				settleStart: new BN(params.settleStart / 1000),
				description: new Array(128).fill(0)
			})
			.accounts({
				reserveMint: params.reserveMint,
				otcAuthority,
				otcState: otcState.publicKey,
				seniorTrancheMint: vyperConfig.seniorTrancheMint,
				juniorTrancheMint: vyperConfig.juniorTrancheMint,

				otcSeniorReserveTokenAccount: otcSeniorReserveTokenAccount.publicKey,
				otcJuniorReserveTokenAccount: otcJuniorReserveTokenAccount.publicKey,
				otcSeniorTrancheTokenAccount: otcSeniorTrancheTokenAccount.publicKey,
				otcJuniorTrancheTokenAccount: otcJuniorTrancheTokenAccount.publicKey,
				vyperTrancheConfig: vyperConfig.trancheConfig,
				vyperCore: vyperCoreProgram.programId
			})
			.signers([otcState, otcSeniorReserveTokenAccount, otcJuniorReserveTokenAccount, otcSeniorTrancheTokenAccount, otcJuniorTrancheTokenAccount])
			.transaction(),
		description: 'Vyper OTC init',
		signers: [otcState, otcSeniorReserveTokenAccount, otcJuniorReserveTokenAccount, otcSeniorTrancheTokenAccount, otcJuniorTrancheTokenAccount]
	};

	return [[vyperCoreInitTxPackage, otcInitTx], otcState.publicKey];
};

type VyperCoreTrancheConfig = {
	trancheConfig: PublicKey;
	juniorTrancheMint: PublicKey;
	seniorTrancheMint: PublicKey;
	trancheAuthority: PublicKey;
	vyperReserve: PublicKey;
};

async function createVyperCoreTrancheConfig(
	provider: AnchorProvider,
	vyperCoreProgram: Program<VyperCore>,
	reserveMint: PublicKey,
	rateProgramID: PublicKey,
	rateState: PublicKey,
	redeemLogicProgramID: PublicKey,
	redeemLogicState: PublicKey,
	trancheConfigOwner: PublicKey
): Promise<[Transaction, Signer[], VyperCoreTrancheConfig]> {
	const juniorTrancheMint = Keypair.generate();
	const seniorTrancheMint = Keypair.generate();
	const trancheConfig = Keypair.generate();

	const [trancheAuthority] = await PublicKey.findProgramAddress(
		[trancheConfig.publicKey.toBuffer(), utils.bytes.utf8.encode('authority')],
		vyperCoreProgram.programId
	);
	const [reserve] = await PublicKey.findProgramAddress([trancheConfig.publicKey.toBuffer(), reserveMint.toBuffer()], vyperCoreProgram.programId);

	const TRANCHE_HALT_FLAGS = {
		NONE: 0,
		HALT_DEPOSITS: 1 << 0,
		HALT_REFRESHES: 1 << 1,
		HALT_REDEEMS: 1 << 2
	};

	const OWNER_RESTRICTED_IX_FLAGS = {
		NONE: 0,
		DEPOSITS: 1 << 0,
		REFRESHES: 1 << 1,
		REDEEMS: 1 << 2
	};

	const DEFAULT_VYPER_CORE_INIT_DATA = {
		trancheMintDecimals: 6,
		ownerRestrictedIxs: OWNER_RESTRICTED_IX_FLAGS.DEPOSITS | OWNER_RESTRICTED_IX_FLAGS.REDEEMS,
		haltFlags: TRANCHE_HALT_FLAGS.NONE
	};

	return [
		await vyperCoreProgram.methods
			.initialize(DEFAULT_VYPER_CORE_INIT_DATA)
			.accounts({
				payer: provider.wallet.publicKey,
				owner: trancheConfigOwner,
				trancheConfig: trancheConfig.publicKey,
				trancheAuthority,
				rateProgram: rateProgramID,
				rateProgramState: rateState,
				redeemLogicProgram: redeemLogicProgramID,
				redeemLogicProgramState: redeemLogicState,
				reserveMint,
				reserve,
				juniorTrancheMint: juniorTrancheMint.publicKey,
				seniorTrancheMint: seniorTrancheMint.publicKey
			})
			.signers([juniorTrancheMint, seniorTrancheMint, trancheConfig])
			.transaction(),
		[juniorTrancheMint, seniorTrancheMint, trancheConfig],
		{
			juniorTrancheMint: juniorTrancheMint.publicKey,
			seniorTrancheMint: seniorTrancheMint.publicKey,
			trancheAuthority,
			trancheConfig: trancheConfig.publicKey,
			vyperReserve: reserve
		}
	];
}

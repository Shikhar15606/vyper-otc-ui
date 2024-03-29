/* eslint-disable eqeqeq */
/* eslint-disable space-before-function-paren */
import { Mint } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { AbsOtcState } from './AbsOtcState';
import { TokenInfo } from './TokenInfo';

export type ContractStatusIds = 'active' | 'expired';

export class ChainOtcState extends AbsOtcState {
	/**
	 * Reserve mint info
	 */
	reserveMintInfo: Mint;

	/**
	 * Reserve token info
	 */
	reserveTokenInfo?: TokenInfo;

	/**
	 * Flag for the settlement execution
	 */
	settleExecuted: boolean;

	/**
	 * Price at settlement
	 */
	priceAtSettlement: number | undefined;

	/**
	 * OTC program token account for buyer tokens
	 */
	programBuyerTAAmount: number;

	/**
	 * OTC program token account for seller tokens
	 */
	programSellerTAAmount: number;

	/**
	 * Buyer wallet
	 */
	buyerWallet: undefined | PublicKey;

	/**
	 * Buyer token account
	 */
	buyerTA: undefined | PublicKey;

	/**
	 * Seller wallet
	 */
	sellerWallet: undefined | PublicKey;

	/**
	 * Seller token account
	 */
	sellerTA: undefined | PublicKey;

	getContractTitle(): string {
		return this.rateState.getPluginDescription();
	}

	isDepositExpired(): boolean {
		return Date.now() > this.depositExpirationAt;
	}

	areBothSidesFunded(): boolean {
		return this.buyerWallet != undefined && this.sellerWallet != undefined;
	}

	isDepositBuyerAvailable(currentUserWallet: PublicKey): boolean {
		if (currentUserWallet === undefined || currentUserWallet === null) return false;
		return !this.isDepositExpired() && this.buyerTA === null && currentUserWallet.toBase58() !== this.sellerWallet?.toBase58();
	}

	isBuyerFunded(): boolean {
		return this.buyerTA != null;
	}

	isDepositSellerAvailable(currentUserWallet: PublicKey): boolean {
		if (currentUserWallet === undefined || currentUserWallet === null) return false;
		return !this.isDepositExpired() && this.sellerTA === null && currentUserWallet.toBase58() !== this.buyerWallet?.toBase58();
	}

	isSellerFunded(): boolean {
		return this.sellerTA != null;
	}

	isSettlementAvailable(): boolean {
		return Date.now() > this.settleAvailableFromAt && !this.settleExecuted;
	}

	isClaimSeniorAvailable(currentUserWallet: PublicKey | undefined): boolean {
		if (currentUserWallet === undefined || currentUserWallet === null) return false;
		return this.settleExecuted && this.buyerWallet.equals(currentUserWallet) && this.programBuyerTAAmount > 0;
	}

	isClaimJuniorAvailable(currentUserWallet: PublicKey | undefined): boolean {
		if (currentUserWallet === undefined || currentUserWallet === null) return false;
		return this.settleExecuted && this.sellerWallet.equals(currentUserWallet) && this.programSellerTAAmount > 0;
	}

	isWithdrawSeniorAvailable(currentUserWallet: PublicKey | undefined): boolean {
		if (currentUserWallet === undefined || currentUserWallet === null) return false;
		return (
			this.isDepositExpired() && this.buyerTA !== null && this.sellerTA === null && this.buyerWallet.equals(currentUserWallet) && this.programBuyerTAAmount > 0
		);
	}

	isWithdrawJuniorAvailable(currentUserWallet: PublicKey | undefined): boolean {
		if (currentUserWallet === undefined || currentUserWallet === null) return false;
		return (
			this.isDepositExpired() &&
			this.buyerTA === null &&
			this.sellerTA !== null &&
			this.sellerWallet.equals(currentUserWallet) &&
			this.programSellerTAAmount > 0
		);
	}

	getContractStatus(): ContractStatusIds {
		const currentTime = Date.now();
		if (currentTime > this.settleAvailableFromAt || (currentTime > this.depositExpirationAt && !this.areBothSidesFunded())) {
			return 'expired';
		}
		return 'active';
	}

	isPnlAvailable(): boolean {
		return this.areBothSidesFunded();
	}

	getPnlBuyer(): number {
		// Long Profit = max(min(leverage*(aggregator_value - strike), collateral_short), - collateral_long)
		const priceToUse = this.settleExecuted ? this.priceAtSettlement : this.rateState.getPluginLastValue();
		return Math.max(Math.min(this.redeemLogicState.notional * (priceToUse - this.redeemLogicState.strike), this.sellerDepositAmount), -this.buyerDepositAmount);
	}

	getPnlSeller(): number {
		// Short Profit = max(-collateral_short, min(collateral_long, leverage*(strike - aggregator_value)))
		const priceToUse = this.settleExecuted ? this.priceAtSettlement : this.rateState.getPluginLastValue();
		return Math.max(-this.sellerDepositAmount, Math.min(this.buyerDepositAmount, this.redeemLogicState.notional * (this.redeemLogicState.strike - priceToUse)));
	}
}

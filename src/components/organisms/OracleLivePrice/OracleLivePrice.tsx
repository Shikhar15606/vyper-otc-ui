/* eslint-disable no-console */
import { useEffect, useState } from 'react';

import { Skeleton } from '@mui/material';
import { useConnection } from '@solana/wallet-adapter-react';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { RatePluginTypeIds } from 'models/plugins/AbsPlugin';
import { RatePythState } from 'models/plugins/rate/RatePythState';
import RateSwitchboardState from 'models/plugins/rate/RateSwitchboardState';
import { formatWithDecimalDigits } from 'utils/numberHelpers';
import { abbreviateAddress } from 'utils/stringHelpers';

type OracleLivePriceInput = {
	oracleType: RatePluginTypeIds;
	pubkey: string;
};

const OracleLivePrice = ({ oracleType, pubkey }: OracleLivePriceInput) => {
	const [priceValue, setPriceValue] = useState(0);
	const [isInitialized, setIsInitialized] = useState(false);
	const { connection } = useConnection();
	const accountToWatch = new PublicKey(pubkey);

	const decodeAccountInfo = async (updatedAccountInfo: AccountInfo<Buffer>): Promise<number> => {
		let newPriceValue = 0;
		if (oracleType === 'switchboard') {
			newPriceValue = await RateSwitchboardState.DecodePriceFromAccountInfo(connection, updatedAccountInfo);
		}
		if (oracleType === 'pyth') {
			newPriceValue = RatePythState.DecodePriceFromAccountInfo(updatedAccountInfo);
		}
		return newPriceValue;
	};

	// first fetch
	useEffect(() => {
		const fetchData = async () => {
			const accountData = await connection.getAccountInfo(accountToWatch);
			const newPriceValue = await decodeAccountInfo(accountData);
			setPriceValue(newPriceValue);
			setIsInitialized(true);
		};

		fetchData();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// listen for account changes
	useEffect(() => {
		const subscriptionId = connection.onAccountChange(
			accountToWatch,
			async (updatedAccountInfo) => {
				// console.log(updatedAccountInfo.data);
				const newPriceValue = await decodeAccountInfo(updatedAccountInfo);

				// if price changed we update it
				if (newPriceValue !== priceValue || !isInitialized) {
					console.log(`${oracleType} price changed for ${abbreviateAddress(pubkey)} from ${priceValue} to ${newPriceValue}`);
					setPriceValue(newPriceValue);
					setIsInitialized(true);
				}
			},
			'confirmed'
		);

		return () => {
			connection.removeAccountChangeListener(subscriptionId);
		};
	});

	return !isInitialized ? <Skeleton variant="rectangular" width={80} height={20} animation="wave" /> : <p>{formatWithDecimalDigits(priceValue, 5)}</p>;
};

export default OracleLivePrice;

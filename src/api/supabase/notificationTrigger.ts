/* eslint-disable no-console */
import { Cluster } from '@solana/web3.js';
import { RedeemLogicPluginTypeIds } from 'models/plugins/AbsPlugin';
import moment from 'moment';

import { SNS_PUBLISHER_RPC_NAME, supabase } from './client';

export const buildMessage = (
	redeemLogicPluginType: RedeemLogicPluginTypeIds,
	underlying: string,
	strike: number,
	notional: number,
	expiry: number,
	url: string
) => {
	return `New ${redeemLogicPluginType.toUpperCase()} contract created!

Underlying: ${underlying}
Strike: ${strike.toPrecision(4)}
Size: ${notional}
Expiry: ${moment(expiry).utc().format('D MMM yyyy hh:mm a [UTC]')}

Trade now👇
${url}`;
};

export const sendSnsPublish = async (cluster: Cluster, content: string) => {
	console.log('sending: ', content);

	const { error } = await supabase.functions.invoke(SNS_PUBLISHER_RPC_NAME, {
		body: JSON.stringify({ cluster, content })
	});

	if (error) console.error(error);
};

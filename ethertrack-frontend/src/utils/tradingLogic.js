import Web3 from 'web3';

export const initializeWeb3 = () => {
    if (window.ethereum) {
        const web3Instance = new Web3(window.ethereum);
        return web3Instance;
    } else {
        alert("Please install MetaMask to proceed.");
        throw new Error("MetaMask not found");
    }
};

export const connectWallet = async (web3) => {
    try {
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        const accounts = await web3.eth.getAccounts();
        return accounts[0];
    } catch (error) {
        console.error("Wallet connection failed", error);
        throw error;
    }
};

export const getBalance = async (web3, account) => {
    try {
        const balanceWei = await web3.eth.getBalance(account);
        return web3.utils.fromWei(balanceWei, 'ether');
    } catch (error) {
        console.error("Error fetching balance", error);
        return 0;
    }
};

export const handleTransaction = async (web3, account, credit, type, orderType) => {
    const amount = parseFloat(prompt(`Enter amount to ${type} for ${credit.type}:`));

    if (!amount || amount <= 0 || (type === 'Buy' && amount > credit.available)) {
        alert('Invalid amount!');
        return;
    }

    const totalCost = web3.utils.toWei((amount * credit.price).toString(), 'ether');

    try {
        const txHash = await web3.eth.sendTransaction({
            from: account,
            to: '0xYourSmartContractAddress', // Replace with actual smart contract address
            value: totalCost,
        });

        alert(`${type} transaction successful! TX Hash: ${txHash.transactionHash}`);
        return {
            date: new Date().toLocaleString(),
            type,
            orderType,
            amount,
            status: 'Completed'
        };
    } catch (error) {
        console.error("Transaction failed", error);
        alert("Transaction failed. Please try again.");
        return {
            date: new Date().toLocaleString(),
            type,
            orderType,
            amount,
            status: 'Failed'
        };
    }
};

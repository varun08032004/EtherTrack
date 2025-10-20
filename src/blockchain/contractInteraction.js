import { ethers } from 'ethers';

// Contract details
const CONTRACT_ADDRESS = "0x995B8Bcf3178Dcf76c6De00A38Eb635Fc107F28e";  // Your deployed contract address
const ABI = [
    // Sample ABI for basic functionality (replace this with your contract's ABI)
    {
        "inputs": [
            { "internalType": "uint256", "name": "_amount", "type": "uint256" }
        ],
        "name": "buyCarbonCredits",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "_amount", "type": "uint256" }
        ],
        "name": "sellCarbonCredits",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

export const getEthereumContract = () => {
    if (!window.ethereum) {
        alert("MetaMask is required for blockchain transactions.");
        return null;
    }

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
};

export const placeOrder = async (orderType, amount, priceInETH) => {
    const contract = getEthereumContract();
    if (!contract) return;

    try {
        if (orderType === "Buy") {
            const tx = await contract.buyCarbonCredits(amount, {
                value: ethers.utils.parseEther(priceInETH.toString())
            });
            await tx.wait();
            alert("Buy order placed successfully!");
        } else if (orderType === "Sell") {
            const tx = await contract.sellCarbonCredits(amount);
            await tx.wait();
            alert("Sell order placed successfully!");
        } else {
            alert("Invalid order type.");
        }
    } catch (error) {
        console.error("Transaction failed:", error);
        alert("Transaction failed. Check console for details.");
    }
};

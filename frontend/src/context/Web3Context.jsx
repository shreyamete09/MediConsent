import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import MediConsentAbi from '../contracts/MediConsentAbi.json';
import { CONTRACT_ADDRESSES, DEFAULT_CONTRACT_ADDRESS } from '../contracts/addresses';

const Web3Context = createContext(null);

export function Web3Provider({ children }) {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [role, setRole] = useState('Unregistered'); // 'Admin' | 'Hospital' | 'Patient' | 'Unregistered'
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);

  // Role Hash constants matching MediConsent.sol
  const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const HOSPITAL_ROLE = ethers.keccak256(ethers.toUtf8Bytes('HOSPITAL_ROLE'));
  const PATIENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('PATIENT_ROLE'));

  const detectRole = useCallback(async (contractInstance, userAddress) => {
    if (!contractInstance || !userAddress) {
      setRole('Unregistered');
      return;
    }

    try {
      const [isAdmin, isHospital, isPatient] = await Promise.all([
        contractInstance.hasRole(DEFAULT_ADMIN_ROLE, userAddress),
        contractInstance.hasRole(HOSPITAL_ROLE, userAddress),
        contractInstance.hasRole(PATIENT_ROLE, userAddress),
      ]);

      if (isAdmin) setRole('Admin');
      else if (isHospital) setRole('Hospital');
      else if (isPatient) setRole('Patient');
      else setRole('Unregistered');
    } catch (err) {
      console.warn('Role detection check error:', err);
      setRole('Unregistered');
    }
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install MetaMask to use MediConsent.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send('eth_requestAccounts', []);
      const userSigner = await browserProvider.getSigner();
      const network = await browserProvider.getNetwork();
      const currentChainId = Number(network.chainId);

      const contractAddress = CONTRACT_ADDRESSES[currentChainId] || DEFAULT_CONTRACT_ADDRESS;
      const contractInstance = new ethers.Contract(contractAddress, MediConsentAbi, userSigner);

      setAccount(accounts[0]);
      setProvider(browserProvider);
      setSigner(userSigner);
      setContract(contractInstance);
      setChainId(currentChainId);

      await detectRole(contractInstance, accounts[0]);
    } catch (err) {
      console.error('Wallet connection error:', err);
      setError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    setContract(null);
    setChainId(null);
    setRole('Unregistered');
  };

  // Re-detect role when triggered externally (e.g., after registration)
  const refreshRole = async () => {
    if (contract && account) {
      await detectRole(contract, account);
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        disconnectWallet();
      } else {
        connectWallet();
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  return (
    <Web3Context.Provider
      value={{
        account,
        provider,
        signer,
        contract,
        chainId,
        role,
        isConnecting,
        error,
        connectWallet,
        disconnectWallet,
        refreshRole,
      }}
    >
      {children}
    </Web3Context.Provider>
  );
}

export const useWeb3 = () => {
  const context = useContext(Web3Context);
  if (!context) {
    throw new Error('useWeb3 must be used within a Web3Provider');
  }
  return context;
};

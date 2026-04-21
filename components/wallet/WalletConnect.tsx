'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'

export function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const connect = async () => {
    if (!(window as any).ethereum) {
      alert('Please install MetaMask!')
      return
    }
    setConnecting(true)
    try {
      const accounts = await (window as any).ethereum.request({ 
        method: 'eth_requestAccounts' 
      })
      setAddress(accounts[0])
    } catch (e) {
      console.error(e)
    } finally {
      setConnecting(false)
    }
  }

  const short = (addr: string) => addr.slice(0,6) + '...' + addr.slice(-4)

  return (
    <motion.button
      onClick={connect}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="px-4 py-2 rounded-lg font-semibold text-sm
                 bg-gradient-to-r from-cyan-500 to-violet-600 
                 text-white cursor-pointer"
    >
      {connecting ? 'Connecting...' : address ? short(address) : 'Connect Wallet'}
    </motion.button>
  )
}

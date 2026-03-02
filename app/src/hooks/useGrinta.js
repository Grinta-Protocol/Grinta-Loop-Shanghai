import { useContract, useReadContract, useAccount, useProvider } from '@starknet-react/core'
import { useState, useEffect, useCallback } from 'react'
import { ADDRESSES, SAFE_ENGINE_ABI, SAFE_MANAGER_ABI } from '../lib/contracts.js'

// Read system-wide rates from SAFEEngine
export function useSystemRates() {
  const { data: redemptionPrice, isLoading: l1, error: e1 } = useReadContract({
    address: ADDRESSES.safeEngine,
    abi: SAFE_ENGINE_ABI,
    functionName: 'get_redemption_price',
    args: [],
    watch: true,
  })
  const { data: redemptionRate, isLoading: l2, error: e2 } = useReadContract({
    address: ADDRESSES.safeEngine,
    abi: SAFE_ENGINE_ABI,
    functionName: 'get_redemption_rate',
    args: [],
    watch: true,
  })
  const { data: collateralPrice, isLoading: l3, error: e3 } = useReadContract({
    address: ADDRESSES.safeEngine,
    abi: SAFE_ENGINE_ABI,
    functionName: 'get_collateral_price',
    args: [],
    watch: true,
  })
  const { data: liquidationRatio, isLoading: l4, error: e4 } = useReadContract({
    address: ADDRESSES.safeEngine,
    abi: SAFE_ENGINE_ABI,
    functionName: 'get_liquidation_ratio',
    args: [],
    watch: true,
  })

  const errors = [e1, e2, e3, e4].filter(Boolean)

  return {
    redemptionPrice,
    redemptionRate,
    collateralPrice,
    liquidationRatio,
    isLoading: l1 || l2 || l3 || l4,
    errors,
  }
}

// Find user's SAFEs by iterating safe_count and checking ownership
export function useUserSafes() {
  const { address } = useAccount()
  const [safes, setSafes] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [debug, setDebug] = useState('waiting...')

  const { contract: engineContract } = useContract({
    address: ADDRESSES.safeEngine,
    abi: SAFE_ENGINE_ABI,
  })

  const fetchSafes = useCallback(async () => {
    if (!address) {
      setDebug('no wallet address')
      setSafes([])
      return
    }
    if (!engineContract) {
      setDebug('no contract instance (provider not ready?)')
      setSafes([])
      return
    }

    setDebug('fetching...')
    setIsLoading(true)
    try {
      const count = await engineContract.get_safe_count()
      const total = Number(count)
      setDebug(`safe_count=${total}, scanning...`)
      const userSafes = []

      for (let id = 1; id <= total; id++) {
        try {
          const owner = await engineContract.get_safe_owner(id)
          const ownerHex = '0x' + BigInt(owner).toString(16)
          const userHex = '0x' + BigInt(address).toString(16)
          if (ownerHex === userHex) {
            const safe = await engineContract.get_safe(id)
            const health = await engineContract.get_safe_health(id)
            userSafes.push({
              id,
              collateral: safe.collateral,
              debt: safe.debt,
              collateralValue: health.collateral_value,
              ltv: health.ltv,
              liquidationPrice: health.liquidation_price,
            })
          }
        } catch (err) {
          setDebug(`safe ${id} error: ${err.message}`)
        }
      }

      setDebug(`found ${userSafes.length} safes`)
      setSafes(userSafes)
    } catch (err) {
      setDebug(`fetchSafes error: ${err.message}`)
      setSafes([])
    } finally {
      setIsLoading(false)
    }
  }, [address, engineContract])

  useEffect(() => {
    fetchSafes()
  }, [fetchSafes])

  return { safes, isLoading, refetch: fetchSafes, debug }
}

// Get health for a single safe
export function useSafeHealth(safeId) {
  const { data, isLoading } = useReadContract({
    address: ADDRESSES.safeManager,
    abi: SAFE_MANAGER_ABI,
    functionName: 'get_position_health',
    args: safeId != null ? [safeId] : [],
    enabled: safeId != null,
    watch: true,
  })

  return { health: data, isLoading }
}

// Get max borrow for a safe
export function useMaxBorrow(safeId) {
  const { data, isLoading } = useReadContract({
    address: ADDRESSES.safeManager,
    abi: SAFE_MANAGER_ABI,
    functionName: 'get_max_borrow',
    args: safeId != null ? [safeId] : [],
    enabled: safeId != null,
    watch: true,
  })

  return { maxBorrow: data, isLoading }
}

import { useState, useCallback } from 'react'

interface UseApiOptions<T> {
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
}

export function useApi<T>(
  apiFunction: (...args: any[]) => Promise<T>,
  options: UseApiOptions<T> = {}
) {
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const execute = useCallback(
    async (...args: any[]) => {
      setIsLoading(true)
      setError(null)
      
      try {
        const result = await apiFunction(...args)
        setData(result)
        options.onSuccess?.(result)
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        options.onError?.(error)
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [apiFunction, options]
  )

  return { data, isLoading, error, execute }
}

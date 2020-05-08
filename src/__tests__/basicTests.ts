import 'jest-extended'

import { EthrStatusRegistry } from '../index'
import { EthrCredentialRevoker } from '../EthrCredentialRevoker'
import * as RevocationRegistryContract from 'revocation-registry'
import * as ganache from 'ganache-cli'
import { DIDDocument } from 'did-resolver'
import { SimpleSigner, createJWT } from 'did-jwt'
import { ContractFactory } from 'ethers'
import { Web3Provider, JsonRpcProvider } from 'ethers/providers'
import { ethers } from 'ethers'
import { sign } from 'ethjs-signer'

const privateKey = 'a285ab66393c5fdda46d6fbad9e27fafd438254ab72ad5acb681a0e9f20f5d7b'
const signerAddress = '0x2036C6CD85692F0Fb2C26E6c6B2ECed9e4478Dfd'
const issuer: string = `did:ethr:${signerAddress}`
const signer = SimpleSigner(privateKey)

describe('EthrStatusRegistry', () => {
  const provider = new Web3Provider(
    ganache.provider({
      accounts: [
        {
          balance: ethers.utils.hexlify(ethers.utils.parseEther('1000'))
        },
        {
          secretKey: '0x' + privateKey,
          balance: ethers.utils.hexlify(ethers.utils.parseEther('1000'))
        }
      ]
    })
  )

  let registry, referenceDoc: DIDDocument, statusEntry: object

  beforeAll(async () => {
    const factory = new ContractFactory(
      RevocationRegistryContract.abi,
      RevocationRegistryContract.bytecode,
      provider.getSigner(0)
    )

    const deployment = await factory.deploy()
    registry = deployment.address
    await deployment.deployed()

    referenceDoc = {
      '@context': 'https://w3id.org/did/v1',
      id: issuer,
      authentication: [
        {
          type: 'Secp256k1SignatureAuthentication2018',
          publicKey: `${issuer}#owner`
        }
      ],
      publicKey: [
        {
          id: `${issuer}#owner`,
          type: 'Secp256k1VerificationKey2018',
          ethereumAddress: signerAddress
        }
      ]
    } as DIDDocument

    statusEntry = {
      type: 'EthrStatusRegistry2019',
      id: `ganache:${registry}`
    }
  })

  describe('happy path', () => {
    it(`should ignore non-revocable credentials`, async () => {
      const token = await createJWT({}, { issuer, signer })
      const statusChecker = new EthrStatusRegistry({ infuraProjectId: 'none' })
      await expect(statusChecker.checkStatus(token, referenceDoc)).resolves.toMatchObject({ status: 'NonRevocable' })
    })

    describe('round trip', () => {
      it(`should create, revoke and verify a credential with revoked status`, async () => {
        const token = await createJWT({ credentialStatus: statusEntry }, { issuer, signer })

        const ethSigner = (rawTx: any, cb: any) => cb(null, sign(rawTx, '0x' + privateKey))

        const revoker = new EthrCredentialRevoker({ networks: [{ name: 'ganache', provider: provider }] })
        const txHash = await revoker.revoke(token, ethSigner)
        const mined = await provider.waitForTransaction(txHash)

        const statusChecker = new EthrStatusRegistry({
          networks: [{ name: 'ganache', provider: provider }]
        })

        await expect(statusChecker.checkStatus(token, referenceDoc)).resolves.toMatchObject({
          revoked: true
        })
      })
    })

    it(`should return revoked status for real credential`, async () => {
      const referenceToken =
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NksifQ.eyJpYXQiOjE1ODgxNzE4MDAsInN1YiI6ImRpZDp3ZWI6dXBvcnQubWUiLCJub25jZSI6IjM4NzE4Njc0NTMiLCJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiQXdlc29tZW5lc3NDcmVkZW50aWFsIl0sImNyZWRlbnRpYWxTdWJqZWN0Ijp7Iml0IjoicmVhbGx5IHdoaXBzIHRoZSBsbGFtbWEncyBhc3MhIn19LCJjcmVkZW50aWFsU3RhdHVzIjp7InR5cGUiOiJFdGhyU3RhdHVzUmVnaXN0cnkyMDE5IiwiaWQiOiJyaW5rZWJ5OjB4OTdmZDI3ODkyY2RjRDAzNWRBZTFmZTcxMjM1YzYzNjA0NEI1OTM0OCJ9LCJpc3MiOiJkaWQ6ZXRocjoweDU0ZDU5ZTNmZmQ3NjkxN2Y2MmRiNzAyYWMzNTRiMTdmMzg0Mjk1NWUifQ.kpUbDVrs3ouIs0vb5IqL4_FAErANCZnFE-lTMlC9Hzpwa4u3_8BaJg4y1KIHq_ROr2oEam9UAujd5A4FbbzFoA'

      // proj ID only usable for this test
      const statusChecker = new EthrStatusRegistry({ infuraProjectId: 'ec9c99d75b834bac8dd4bfacad8cfdf7' })

      const referenceDoc = {
        id: 'did:ethr:0x54d59e3ffd76917f62db702ac354b17f3842955e',
        publicKey: [
          {
            id: 'did:ethr:0x54d59e3ffd76917f62db702ac354b17f3842955e#owner',
            type: 'Secp256k1VerificationKey2018',
            ethereumAddress: '0x54d59e3ffd76917f62db702ac354b17f3842955e'
          }
        ]
      } as DIDDocument

      await expect(statusChecker.checkStatus(referenceToken, referenceDoc)).resolves.toMatchObject({
        revoked: true
      })
    })

    it(`should return valid credential status for fresh credential`, async () => {
      const token = await createJWT({ credentialStatus: statusEntry }, { issuer, signer })
      const statusChecker = new EthrStatusRegistry({
        networks: [{ name: 'ganache', provider: provider }]
      })
      await expect(statusChecker.checkStatus(token, referenceDoc)).resolves.toMatchObject({
        revoked: false
      })
    })
  })

  describe('error scenarios', () => {
    it('should be able to instantiate Status using infura ID', () => {
      expect(new EthrStatusRegistry({ infuraProjectId: 'none' })).not.toBeNil()
    })

    it('should be able to instantiate Status using single network definition', () => {
      expect(new EthrStatusRegistry({ rpcUrl: 'example.com' })).not.toBeNil()
    })

    it('should be able to instantiate Status using multiple network definitions', () => {
      expect(
        new EthrStatusRegistry({
          networks: [
            { name: 'mainnet', rpcUrl: 'example.com' },
            { name: 'rinkeby', rpcUrl: 'rinkeby.example.com' },
            { name: 'local', provider: new JsonRpcProvider('http://localhost:8545') }
          ]
        })
      ).not.toBeNil()
    })

    it('should have proper signature for "asMethodName"', () => {
      let mapping = new EthrStatusRegistry({ infuraProjectId: 'none' }).asStatusMethod
      expect(mapping['EthrStatusRegistry2019']).toBeFunction
    })

    it(`should reject unknown status method`, async () => {
      const token = await createJWT(
        { credentialStatus: { type: 'unknown', id: 'something something' } },
        { issuer, signer }
      )
      const statusChecker = new EthrStatusRegistry({ infuraProjectId: 'none' })
      await expect(statusChecker.checkStatus(token, referenceDoc)).rejects.toMatch(
        'unsupported credential status method'
      )
    })

    it(`should reject unknown networkIDs`, async () => {
      const token = await createJWT({ credentialStatus: statusEntry }, { issuer, signer })
      const statusChecker = new EthrStatusRegistry({
        networks: [{ name: 'some net', rpcUrl: 'example.com' }]
      })
      await expect(statusChecker.checkStatus(token, referenceDoc)).rejects.toMatch(
        'networkId (ganache) for status check not configured'
      )
    })

    it(`should throw an error when the RPC endpoint is mis-configured`, async () => {
      const token = await createJWT({ credentialStatus: statusEntry }, { issuer, signer })
      const statusChecker = new EthrStatusRegistry({
        networks: [{ name: 'ganache', rpcUrl: '0.0.0.0' }]
      })

      await expect(statusChecker.checkStatus(token, referenceDoc)).rejects.toThrow(/CONNECTION ERROR/)
    })
  })
})

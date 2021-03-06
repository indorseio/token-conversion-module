const bancorNetworkSuccess = artifacts.require('BancorNetworkSuccess');
const bancorNetworkFailed = artifacts.require('BancorNetworkFailed')
const bancorNetworkReEntrant = artifacts.require('BancorNetworkReEntrant')
const bancorContractRegistry = artifacts.require('BancorContractRegistry')
const tokenConversionModule = artifacts.require('IndTokenPayment')
const SelfDestructor = artifacts.require('SelfDestructor')
const dummyERC20 = artifacts.require('DummyToken')
const abiDecoder = require('abi-decoder'); 
const utils  = require("./Utils")


contract('TokenPaymentBancor', accounts => {

    let convPath = ['0x8fba0c8740177d44b5a75d469b9a69562905cf13', '0x8fba0c8740177d44b5a75d469b9a69562905cf23'];
    let destWallet = '0xf20b9e713a33f61fa38792d2afaf1cd30339126a';
    let bancorNetworkHash = '0x42616e636f724e6574776f726b00000000000000000000000000000000000000';
    let minConvRate = 1;    
    let contractRegistry;
                   

    before(async () => {       
        contractRegistry = await bancorContractRegistry.new();        
    })

    function parseLogs(decodedLog){
        //Only one Event due to mocks, so using index 0
        let parsedEvent = {};    
        for (event of decodedLog)        {
            if (event.name == "reEntry"){
                parsedEvent.r1Status = "UNKNOWN" //Set default
                parsedEvent.r2Status = "UNKNOWN"
                for (elem of event.events) {
                    if (elem.name == "r1Status"){
                        parsedEvent.r1Status = elem.value;
                    }else if (elem.name == "r2Status") {
                        parsedEvent.r2Status = elem.value;
                    }                
                }               
            } else{ // The only other event emmited is conversionSucceeded
                for (elem of event.events) {
                    if (elem.name == "from") {
                        parsedEvent.from = elem.value;
                    } else if (elem.name == "fromTokenVal") {
                        parsedEvent.fromTokenVal = elem.value;
                    } else if (elem.name == "dest") {
                        parsedEvent.dest = elem.value;
                    } else if (elem.name == "minReturn") {
                        parsedEvent.minReturn = elem.value;
                    } else if (elem.name == "destTokenVal") {
                        parsedEvent.destTokenVal = elem.value;
                    } else if (elem.name == "oldBalance") {
                        parsedEvent.oldBalance = elem.value;
                    } else if (elem.name == "newBalance") {
                        parsedEvent.newBalance = elem.value;
                    }
                }
            }
        }        
        return parsedEvent;
    }

     it('should sucessfully convert ETH to ERC20 tokens on convertFor call', async () => {    
        let bancorNwSuccess = await bancorNetworkSuccess.new();   
        let dummyToken = await dummyERC20.new(bancorNwSuccess.address);
        await contractRegistry.setAddress(bancorNetworkHash, bancorNwSuccess.address);
        convPath.push(dummyToken.address);        
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, minConvRate);        
        let tokAddr = tokenConvertor.address;       
        let result = await web3.eth.sendTransaction({ from: web3.eth.accounts[0] , to: tokAddr, value: 10, gas: 900000 })  
        let recpt = await web3.eth.getTransactionReceipt(result);
        abiDecoder.addABI(tokenConvertor.abi);
        const parsedEvent = parseLogs(abiDecoder.decodeLogs(recpt.logs));
        assert.equal(parsedEvent.from, web3.eth.accounts[0]);
        assert.equal(parsedEvent.fromTokenVal, 10);
        assert.equal(parsedEvent.dest, destWallet);
        assert(parsedEvent.destTokenVal > minConvRate* 10,"Invalid conversion");   
  
    });

    it('should sucessfully withdraw ER20 tokens if locked in contract', async () => {
        let bancorNwSuccess = await bancorNetworkSuccess.new();      
        await contractRegistry.setAddress(bancorNetworkHash, bancorNwSuccess.address);
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, minConvRate);        
        let selfDestruct = await SelfDestructor.new()
        await web3.eth.sendTransaction({ from: web3.eth.accounts[0] ,value:10 , to: selfDestruct.address});
        await selfDestruct.killIt(tokenConvertor.address);
        assert.equal(web3.eth.getBalance(tokenConvertor.address).toNumber(),10);
        assert.equal(web3.eth.getBalance(destWallet).toNumber(),0);
        await tokenConvertor.withdrawEther();
        assert.equal(web3.eth.getBalance(destWallet).toNumber(),10);
        assert.equal(web3.eth.getBalance(tokenConvertor.address).toNumber(),0);
    });

    it('should be possible to extract any ERC20 token sent with destination as contract address', async () => {
        let bancorNwSuccess = await bancorNetworkSuccess.new();
        let dummyToken = await dummyERC20.new(web3.eth.accounts[1]);
        await contractRegistry.setAddress(bancorNetworkHash, bancorNwSuccess.address);
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, minConvRate);
        await dummyToken.transfer(tokenConvertor.address, 200, { from: web3.eth.accounts[1] })
        let destWalletOldERC20Balance = await dummyToken.balanceOf(destWallet);
        assert.equal(destWalletOldERC20Balance.toNumber(), 0)
        await tokenConvertor.withdrawERC20Token(dummyToken.address)
        let destWalletNewERC20Balance = await dummyToken.balanceOf(destWallet);
        assert.equal(destWalletNewERC20Balance.toNumber(), 200);
    });    

    it('should fail to convert when bancor network is missing in registry', async () => {
        let emptyRegistry = await bancorContractRegistry.new();
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, emptyRegistry.address, minConvRate);        
        let tokAddr = tokenConvertor.address;
        try{
            let result = await web3.eth.sendTransaction({ from: web3.eth.accounts[0] , to: tokAddr, value: 10, gas: 900000 }) 
            throw('Should not execute');       
        }catch(error){
            utils.ensureException(error);
        }
    });   

    it('should fail to execeute ownerOnly functions', async () => {
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, minConvRate);
        
        try{
            await tokenConvertor.setConversionPath(convPath,{from: web3.eth.accounts[1]});
            throw('Should not execute');
        }catch(error){
             utils.ensureException(error);
        }

        try{
            await tokenConvertor.setBancorRegistry(destWallet,{from: web3.eth.accounts[1]});
            throw('Should not execute');
        }catch(error){
             utils.ensureException(error);
        }

        try{
            await tokenConvertor.setMinConversionRate(10,{from: web3.eth.accounts[1]});
            throw('Should not execute');
        }catch(error){
             utils.ensureException(error);
        }

        try{
            await tokenConvertor.setDestinationWallet(destWallet,{from: web3.eth.accounts[1]});
            throw('Should not execute');
        }catch(error){
             utils.ensureException(error);
        }

        try{
            await tokenConvertor.withdrawERC20Token(destWallet,{from: web3.eth.accounts[1]});
            throw('Should not execute');
        }catch(error){
             utils.ensureException(error);
        }

        try{
            await tokenConvertor.withdrawEther({from: web3.eth.accounts[1]});
            throw('Should not execute');
        }catch(error){            
            utils.ensureException(error);
        }        
    });  
   
    it('should fail to convert when bancor network throws an exception', async () => {
        let bancorNwFail = await bancorNetworkFailed.new();      
        await contractRegistry.setAddress(bancorNetworkHash, bancorNwFail.address);
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, minConvRate);        
        let tokAddr = tokenConvertor.address;
        try{
            let result = await web3.eth.sendTransaction({ from: web3.eth.accounts[0] , to: tokAddr, value: 10, gas: 900000 });
            throw('Should not execute')
        }catch(error){
            utils.ensureException(error);
        }         
    });

    it('should fail if less than requested tokens are returned back', async () => {
        let bancorNwSuccess = await bancorNetworkSuccess.new();      
        await contractRegistry.setAddress(bancorNetworkHash, bancorNwSuccess.address);
        let highConvRate = 500;
        let dummyToken = await dummyERC20.new(bancorNwSuccess.address);
        convPath.push(dummyToken.address);        
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, highConvRate);        
        let tokAddr = tokenConvertor.address;
        try{
            let result = await web3.eth.sendTransaction({ from: web3.eth.accounts[0] , to: tokAddr, value: 10, gas: 900000 })
            throw('Should not execute')        
        } catch(error){
            utils.ensureException(error);
        }        
    }); 

    
    it('should fail if any reentrancy is encountered', async () => {
        let bancorNwReEntrant = await bancorNetworkReEntrant.new();
        let dummyToken = await dummyERC20.new(bancorNwReEntrant.address);
        await contractRegistry.setAddress(bancorNetworkHash, bancorNwReEntrant.address);
        convPath.push(dummyToken.address);
        let tokenConvertor = await tokenConversionModule.new(convPath, destWallet, contractRegistry.address, minConvRate);
        let tokAddr = tokenConvertor.address;
        let result = await web3.eth.sendTransaction({ from: web3.eth.accounts[0], to: tokAddr, value: 10, gas: 900000 })
        let recpt = await web3.eth.getTransactionReceipt(result);
        abiDecoder.addABI(tokenConvertor.abi);
        abiDecoder.addABI(bancorNwReEntrant.abi);
        const parsedEvent = parseLogs(abiDecoder.decodeLogs(recpt.logs));        
        assert.equal(parsedEvent.r1Status,false);
        assert.equal(parsedEvent.r2Status, false);
    });
})
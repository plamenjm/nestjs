import {Logger} from '@nestjs/common';
import {OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer} from '@nestjs/websockets';
import {Server} from 'socket.io';
import {Socket} from 'socket.io-client';
import {OnEvent} from '@nestjs/event-emitter';
import {Config} from '../config';
import {LiveTradesEvent, WebSocketGatewayCors} from './live-trades-wsclient.gateway';


//---

type TSMessageLiveSubscribe = {event: string, channel: string, pair: string}


//---

@WebSocketGateway({cors: WebSocketGatewayCors})
export class LiveTradesServerGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() private readonly server: Server

    private readonly logger = new Logger('Server')
    private readonly verbose = false

    private readonly trades = {}
    private readonly subscribed = {}

    afterInit() {
        //this.logger.log('Init')
        Config.LiveTradesSymbol.forEach(symbol => {
            this.trades[symbol] = []
            this.subscribed[symbol] = []
        })
    }

    @OnEvent('LiveTradesEvent')
    eventHandler(event: LiveTradesEvent) {
        Object.keys(event.trades).forEach(symbol => { // [ 'BTCUSD' => [ '1494734166-tBTCUSD', 1705081553, 43535, 0.0156206 ] ]
            const count = event.trades[symbol].length

            if (count) {
                this.trades[symbol] = this.trades[symbol].concat(event.trades[symbol])
            }

            if (count && this.subscribed[symbol].length) {
                const message = JSON.stringify([0, event.trades[symbol]])
                this.subscribed[symbol].forEach(socket => {
                    if (this.verbose || count > 1) this.log('<', '', count === 1 ? message : count + ' messages')
                    socket.emit('live', message as any)
                })
            }
        })
    }

    async handleConnection(socket: Socket) {
        this.log('connect', '', '', socket)
    }

    async handleDisconnect(socket: Socket) {
        Config.LiveTradesSymbol.forEach(symbol => {
            const idx = this.subscribed[symbol].indexOf(socket)
            delete this.subscribed[symbol][idx]
        })
        this.log('disconnect', '', '', socket)
    }

    @SubscribeMessage('live')
    async onMessageLive(socket: Socket, data) {
        const json = JSON.parse(data) as TSMessageLiveSubscribe
        if (json && json.event === 'subscribe' && json.channel === 'trades') { // {event: 'subscribe', channel: 'trades', pair: 'BTCUSD'}
            if (this.subscribed[json.pair]) this.subscribed[json.pair].push(socket)
        }

        this.log('>', 'live', data, socket)
        if (this.verbose) this.log('<', 'live', data, socket)
        socket.emit('live', data) // echo

        //return '{...}' //to-do
    }

    @SubscribeMessage('log')
    async onMessageLog(socket: Socket, data) {
        const json = JSON.parse(data)
        if (json.event === 'log' && json.channel === 'trades') { // {event: 'log', channel: 'trades', pair: 'BTCUSD', from: 1705081553, to: 1705081553}
            if (this.trades[json.pair]) {
                const eventsAll = this.trades[json.pair] // [ 'BTCUSD' => [ '1494734166-tBTCUSD', 1705081553, 43535, 0.0156206 ] ]
                const events = eventsAll.filter(event => json.from <= event[1] && event[1] < json.to)
                if (events.length) {
                    const log = events.length + ' messages (' + json.pair + ', ' + this.eventTime(json.from) + '/' + this.eventTime(json.to) + ')'
                    this.log('<', 'log', log, socket)
                    socket.emit('log', JSON.stringify([0, events]))
                    return
                }
            }
        }

        this.log('>', 'log', data, socket)
        if (this.verbose) this.log('<', 'log', data, socket)
        socket.emit('log', data) // echo
    }

    log(action, prefix = '', data = '', socket: Socket = undefined) {
        if (action) action = ' ' + action
        if (prefix) prefix += '/'
        if (data) data = ' ' + data
        this.logger.log(`[${prefix}${socket?.id ?? ''}/${this.server.sockets.sockets.size}${action}]${data}`)
    }

    eventTime(time) {
        return (new Date(time * 1000)).toISOString()
            .split('T').join(' ')
            .split('.').slice(0, -1).join('')
    }
}
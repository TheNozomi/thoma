import { chunkify, Colors, getInteractionChannel, getInteractionGuild, getWebhook, getWebhookData } from '../../utilities'
import type { CommandInteraction, MessageActionRowOptions, MessageButtonOptions, NewsChannel, NonThreadGuildBasedChannel, TextChannel, Webhook } from 'discord.js'
import type { IKeyVInterface, IRole } from '../../database'
import { KeyV, RoleMessages, Roles } from '../../database'
import { ApplyOptions } from '@sapphire/decorators'
//import { env } from '../../lib'
import { MessageEmbed } from 'discord.js'
import { SlashCommand } from '../../framework'
import type { SlashCommandOptions } from '../../framework'

@ApplyOptions<SlashCommandOptions>( {
	description: 'Configura un mensaje con botones para elegir roles.',
	enabled: true,
	name: 'roles',
	options: [
		{
			description: 'Especifica el canal a configurar.',
			name: 'canal',
			options: [
				{
					channelTypes: [
						'GUILD_NEWS', 'GUILD_TEXT'
					],
					description: 'Mención del canal',
					name: 'canal',
					required: true,
					type: 'CHANNEL'
				}
			],
			type: 'SUB_COMMAND'
		},
		{
			description: 'Especifica el mensaje a configurar.',
			name: 'mensaje',
			options: [
				{
					description: 'Identificador del mensaje',
					name: 'mensaje',
					required: true,
					type: 'STRING'
				}
			],
			type: 'SUB_COMMAND'
		},
		{
			description: 'Copia un mensaje del canal actual para usarlo en el canal especificado.',
			name: 'copiar-mensaje',
			options: [
				{
					description: 'Identificador del mensaje',
					name: 'mensaje',
					required: true,
					type: 'STRING'
				}
			],
			type: 'SUB_COMMAND'
		},
		{
			description: 'Edita el mensaje usando un mensaje del canal actual.',
			name: 'editar-mensaje',
			options: [
				{
					description: 'Identificador del mensaje',
					name: 'mensaje',
					required: true,
					type: 'STRING'
				}
			],
			type: 'SUB_COMMAND'
		},
		{
			description: 'Añade el botón para un rol.',
			name: 'agregar-rol',
			options: [
				{
					description: 'Rol a colocar',
					name: 'rol',
					required: true,
					type: 'ROLE'
				},
				{
					description: 'Texto del botón',
					name: 'etiqueta',
					type: 'STRING'
				},
				{
					description: 'Emoji del botón',
					name: 'emoji',
					type: 'STRING'
				}
			],
			type: 'SUB_COMMAND'
		},
		{
			description: 'Añade el botón para un rol.',
			name: 'eliminar-rol',
			options: [
				{
					description: 'Rol a colocar',
					name: 'rol',
					required: true,
					type: 'ROLE'
				}
			],
			type: 'SUB_COMMAND'
		}
	]
} )
export class UserSlash extends SlashCommand {
	public async run( interaction: CommandInteraction ): Promise<void> {
		if ( !interaction.inGuild() || !interaction.memberPermissions.has( 'MANAGE_GUILD' ) ) {
			await interaction.reply( {
				content: 'Este comando sólo puede ser usado en servidores por miembros con permiso para gestionar el servidor.',
				ephemeral: true
			} )
			return
		}
		await interaction.deferReply()

		const subcommand = interaction.options.getSubcommand()
		if ( subcommand === 'canal' ) {
			await this.setChannel( interaction )
			return
		} else {
			const record = await this.getChannel( interaction.guildId ) as IKeyVInterface | null
			if ( !record ) {
				const embed = new MessageEmbed( {
					color: Colors.amber[ 10 ],
					description: 'Necesitas especificar un canal usando `/roles canal`.'
				} )
				await interaction.editReply( {
					embeds: [ embed ]
				} )
				return
			}
		}

		if ( subcommand === 'mensaje' ) {
			await this.setMessage( interaction )
		} else if ( subcommand === 'copiar-mensaje' ) {
			await this.copyMessage( interaction )
		} else if ( subcommand === 'editar-mensaje' || subcommand === 'agregar-rol' || subcommand === 'eliminar-rol' ) {
			const record = await KeyV.findOne( {
				where: {
					guild: interaction.guildId,
					key: 'roles-message'
				}
			} )
			if ( !record ) {
				const embed = new MessageEmbed( {
					color: Colors.amber[ 10 ],
					description: 'Necesitas especificar un mensaje usando `/roles mensaje`.'
				} )
				await interaction.editReply( {
					embeds: [ embed ]
				} )
				return
			}

			const messageId = record.getDataValue( 'value' )
			if ( subcommand === 'editar-mensaje' ) {
				await this.copyMessage( interaction, messageId )
			} else if ( subcommand === 'agregar-rol' ) {
				await this.setRole( interaction, messageId )
			} else {
				await this.unsetRole( interaction, messageId )
			}
		} else {
			await interaction.editReply( 'No reconozco el comando que has utilizado.' )
		}
	}

	private async copyMessage( interaction: CommandInteraction<'present'>, messageToEdit?: string ): Promise<void> {
		const messageId = interaction.options.getString( 'mensaje', true )
		const currentChannel = await getInteractionChannel( interaction )
		if ( !currentChannel ) return
		const message = await currentChannel.messages.fetch( messageId )
			.catch( () => null )
		if ( !message ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: 'No he podido encontrar el mensaje proporcionado. Asegúrate de que no haya sido borrado y estés usando el comando en el mismo canal donde está el mensaje.'
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		const guild = await getInteractionGuild( interaction )

		const rolesChannelId = ( await this.getChannel( interaction.guildId ) ).getDataValue( 'value' )
		const rolesChannel = await guild?.channels.fetch( rolesChannelId )
			.catch( () => null )
		if ( !this.isValidChannel( interaction, rolesChannel ) ) return

		let webhook: Webhook | null = null
		if ( messageToEdit ) {
			const existingMessage = await rolesChannel.messages.fetch( messageToEdit )
				.catch( () => null )
			if ( !existingMessage ) {
				const embed = new MessageEmbed( {
					color: Colors.red[ 10 ],
					description: 'No he podido encontrar el mensaje a editar. Asegúrate de que no haya sido borrado y que tenga acceso a los mensajes del canal.'
				} )
				await interaction.editReply( {
					embeds: [ embed ]
				} )
				return
			}
			webhook = await existingMessage.fetchWebhook()
		}
		if ( !webhook ) {
			webhook = await getWebhook( rolesChannel )
		}

		const webhookData = message.webhookId
			? {
				avatarURL: message.author.avatarURL( { format: 'png' } ) ?? '',
				username: message.author.username
			}
			: await getWebhookData( {
				channelId: rolesChannel.id,
				guildId: interaction.guildId
			} )

		const webhookMessageOptions = {
			content: message.content.length === 0 ? null : message.content,
			embeds: message.embeds
		}
		const webhookMessage = messageToEdit
			? await webhook.editMessage( messageToEdit, webhookMessageOptions )
			: await webhook.send( {
				...webhookData,
				...webhookMessageOptions
			} )

		if ( !messageToEdit ) {
			await RoleMessages.create( {
				channel: rolesChannel.id,
				guild: interaction.guildId,
				message: webhookMessage.id
			} )
			await KeyV.upsert( {
				guild: interaction.guildId,
				key: 'roles-message',
				value: webhookMessage.id
			} )
		}

		const embed = new MessageEmbed( {
			color: Colors.green[ 10 ],
			description: `Se ha ${ messageToEdit ? 'editado' : 'enviado' } el mensaje exitosamente. Ahora puedes añadir botones para roles en él.`
		} )
		await interaction.editReply( {
			embeds: [ embed ]
		} )
	}

	private async setChannel( interaction: CommandInteraction<'present'> ): Promise<void> {
		const channel = interaction.options.getChannel( 'canal', true )
		await KeyV.upsert( {
			guild: interaction.guildId,
			key: 'roles-channel',
			value: channel.id
		} )
		const embed = new MessageEmbed( {
			color: Colors.green[ 10 ],
			description: `Se ha configurado el canal exitosamente: <#${ channel.id }>`
		} )
		await interaction.editReply( {
			embeds: [ embed ]
		} )
	}

	private async setMessage( interaction: CommandInteraction<'present'> ): Promise<void> {
		const messageId = interaction.options.getString( 'mensaje', true )
		const guild = await getInteractionGuild( interaction )
		const channel = await guild?.channels.fetch( ( await this.getChannel( interaction.guildId ) ).getDataValue( 'value' ) )
			.catch( () => null )
		if ( !this.isValidChannel( interaction, channel ) ) return

		const message = await channel.messages.fetch( messageId )
			.catch( () => null )

		if ( !message ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: 'No he podido encontrar el mensaje especificado. Asegúrate de que no haya sido borrado y que tenga acceso a los mensajes del canal.'
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		const webhook = await message.fetchWebhook()
			.catch( () => null )
		const isOwnedWebhook = webhook?.owner?.id && webhook.owner.id === this.container.client.user?.id

		if ( !isOwnedWebhook ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: 'Este mensaje no fue enviado por el bot, por lo que no es posible editarlo.\nPuedes copiarlo y re-enviarlo usando `/roles copiar-mensaje`.'
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		await KeyV.upsert( {
			guild: interaction.guildId,
			key: 'roles-message',
			value: message.id
		} )
		const embed = new MessageEmbed( {
			color: Colors.green[ 10 ],
			description: 'Se ha configurado el mensaje exitosamente.'
		} )
		await interaction.editReply( {
			embeds: [ embed ]
		} )
	}

	private async setRole( interaction: CommandInteraction<'present'>, messageId: string ): Promise<void> {
		const role = interaction.options.getRole( 'rol', true )
		const label = interaction.options.getString( 'etiqueta' )
		const emoji = interaction.options.getString( 'emoji' )

		if ( role.position === 0 || role.managed ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: `<@&${ role.id }> es un rol que pertenece a un bot o @everyone, y no puede ser asignado.`
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		const buttonsCount = await Roles.count( {
			where: {
				message: messageId
			}
		} )
		if ( buttonsCount >= 25 ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: 'Solo puede haber un máximo de 25 botones por mensaje.'
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		const alreadyExists = await Roles.findOne( {
			where: {
				message: messageId,
				role: role.id
			}
		} )
		if ( alreadyExists ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: `Solo puede haber un botón por rol, y parece que <@&${ role.id }> ya está configurado en el mensaje actual.`
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		if ( !label && !emoji ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: 'Debes de especificar un valor al menos para la etiqueta o el emoji.'
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		const data: IRole = {
			message: messageId,
			role: role.id
		}
		if ( label ) data.label = label
		if ( emoji ) {
			const customEmoji = emoji.match( /<.*?:([0-9]+)>/ )?.[ 1 ]
			if ( customEmoji ) {
				data.emoji = customEmoji
			} else {
				data.emoji = emoji
			}
		}

		await Roles.create( data )
		await this.updateButtons( interaction, messageId )

		const embed = new MessageEmbed( {
			color: role.color,
			description: `Se ha añadido un botón para <@&${ role.id }>.`
		} )
		await interaction.editReply( {
			embeds: [ embed ]
		} )
	}

	private async unsetRole( interaction: CommandInteraction<'present'>, messageId: string ): Promise<void> {
		const role = interaction.options.getRole( 'rol', true )

		const record = await Roles.findOne( {
			where: {
				message: messageId,
				role: role.id
			}
		} )
		if ( !record ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: `El rol <@&${ role.id }> no se encontraba configurado en el mensaje actual.`
			} )
			await interaction.editReply( {
				embeds: [ embed ]
			} )
			return
		}

		await record.destroy()
		await this.updateButtons( interaction, messageId )

		const embed = new MessageEmbed( {
			color: role.color,
			description: `Se ha eliminado el botón para <@&${ role.id }>.`
		} )
		await interaction.editReply( {
			embeds: [ embed ]
		} )
	}

	private getChannel( guildId: string ): Promise<IKeyVInterface> {
		return KeyV.findOne( {
			where: {
				guild: guildId,
				key: 'roles-channel'
			}
		} ) as Promise<IKeyVInterface>
	}

	private isValidChannel( interaction: CommandInteraction<'present'>, channel: NonThreadGuildBasedChannel | null | undefined ): channel is NewsChannel | TextChannel {
		if ( !channel ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: 'No he podido encontrar el canal configurado, es posible que haya sido borrado.'
			} )
			void interaction.editReply( {
				embeds: [ embed ]
			} )
			return false
		} else if ( channel.type !== 'GUILD_NEWS' && channel.type !== 'GUILD_TEXT' ) {
			const embed = new MessageEmbed( {
				color: Colors.red[ 10 ],
				description: `No puedo usar <#${ channel.id }> porque no es un canal de texto o de noticias.`
			} )
			void interaction.editReply( {
				embeds: [ embed ]
			} )
			return false
		}
		return true
	}

	private getComponents( roles: IRole[] ): Array<MessageActionRowOptions & { type: 'ACTION_ROW' }> {
		const rawButtons: MessageButtonOptions[] = []
		for ( const role of roles ) {
			const button: MessageButtonOptions = {
				customId: `role-${ role.role }`,
				style: 'SECONDARY',
				type: 'BUTTON'
			}
			if ( role.label ) button.label = role.label
			if ( role.emoji ) button.emoji = role.emoji
			rawButtons.push( button )
		}
		const buttons = chunkify( rawButtons, 5 ).map( chunk => ( {
			components: chunk,
			type: 'ACTION_ROW'
		} as MessageActionRowOptions & { type: 'ACTION_ROW' } ) )
		return buttons
	}

	private async updateButtons( interaction: CommandInteraction<'present'>, messageId: string ): Promise<void> {
		const guild = await getInteractionGuild( interaction )
		const channelId = ( await RoleMessages.findByPk( messageId ) )?.getDataValue( 'channel' )
		const channel = channelId
			? await guild?.channels.fetch( channelId )
				.catch( () => null )
			: null

		if ( !this.isValidChannel( interaction, channel ) ) return
		const message = await channel.messages.fetch( messageId )
			.catch( () => null )
		if ( !message ) return

		const webhook = await message.fetchWebhook()
		const roles = await Roles.findAll( {
			order: [ 'id' ],
			where: {
				message: messageId
			}
		} )

		const components = this.getComponents( roles )
		await webhook.editMessage( messageId, {
			components
		} )
	}
}
-- Script Roblox pour le Chat Vocal
-- Placez ce script dans un LocalScript ou ServerScript dans votre jeu

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

-- Configuration
local SERVER_URL = "https://voiceperonalis-e.onrender.com" -- Changez pour localhost en développement
local UPDATE_INTERVAL = 0.5 -- Interval d'envoi de position en secondes

local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer

local userId = tostring(LocalPlayer.UserId)
local username = LocalPlayer.Name
local isConnected = false

-- Fonction pour envoyer la position au serveur
local function sendPosition()
	if not isConnected then return end

	local character = LocalPlayer.Character
	if not character then return end

	local humanoidRootPart = character:FindFirstChild("HumanoidRootPart")
	if not humanoidRootPart then return end

	local position = humanoidRootPart.Position

	local success, result = pcall(function()
		return HttpService:RequestAsync({
			Url = SERVER_URL .. "/api/update",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				userId = userId,
				username = username,
				position = {
					x = position.X,
					y = position.Y,
					z = position.Z
				},
				isTalking = false -- À mettre à true quand le joueur parle
			})
		})
	end)

	if success then
		print("[VoiceChat] Position envoyée:", result)
	else
		warn("[VoiceChat] Erreur envoi position:", result)
	end
end

-- Fonction pour se connecter au serveur
local function connectToServer()
	local success, result = pcall(function()
		return HttpService:RequestAsync({
			Url = SERVER_URL .. "/api/update",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				userId = userId,
				username = username,
				position = { x = 0, y = 0, z = 0 },
				isTalking = false
			})
		})
	end)

	if success then
		isConnected = true
		print("[VoiceChat] Connecté au serveur:", result)
	else
		warn("[VoiceChat] Erreur de connexion:", result)
	end
end

-- Fonction pour se déconnecter
local function disconnectFromServer()
	if not isConnected then return end

	local success, result = pcall(function()
		return HttpService:RequestAsync({
			Url = SERVER_URL .. "/api/leave",
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json"
			},
			Body = HttpService:JSONEncode({
				userId = userId
			})
		})
	end)

	isConnected = false
	print("[VoiceChat] Déconnecté:", result)
end

-- Connexion au démarrage
connectToServer()

-- Boucle d'envoi de position
RunService.Heartbeat:Connect(function()
	sendPosition()
end)

-- Déconnexion quand le joueur quitte
Players.PlayerRemoving:Connect(function(player)
	if player == LocalPlayer then
		disconnectFromServer()
	end
end)

print("[VoiceChat] Script démarré pour:", username)

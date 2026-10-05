/**
 * Example scripts shown to the AI. Tests check that each one passes the
 * checker and behaves as described in play, so the AI never learns from a
 * broken example.
 */
export const SCRIPT_EXAMPLES: { title: string; json: string }[] = [
  {
    title: 'an enemy that walks, charges when the player is near, then rests',
    json: `{"name":"Charger","description":"Walks back and forth; charges when the player is within 5 tiles, then rests for a second.","vars":[{"name":"walk_speed","value":50},{"name":"charge_speed","value":220},{"name":"range","value":160}],"states":["walk","charge","rest"],"handlers":[
 {"when":{"on":"tick"},"state":"walk","if":null,"do":[{"do":"if","cond":"solid_at(self.x + self.facing * (self.width / 2 + 2), self.y) or not solid_at(self.x + self.facing * (self.width / 2 + 2), self.y + self.height / 2 + 4)","then":[{"do":"face","dir":"-self.facing"}],"else":[]},{"do":"velocity","x":"self.facing * walk_speed","y":null}]},
 {"when":{"on":"tick"},"state":"walk","if":"dist(player) < range and can_see(player)","do":[{"do":"face","dir":"sign(dx(player))"},{"do":"state","name":"charge"}]},
 {"when":{"on":"tick"},"state":"charge","if":null,"do":[{"do":"velocity","x":"self.facing * charge_speed","y":null}]},
 {"when":{"on":"tick"},"state":"charge","if":"state_time > 1.2 or solid_at(self.x + self.facing * (self.width / 2 + 2), self.y)","do":[{"do":"state","name":"rest"}]},
 {"when":{"on":"enter_state"},"state":"rest","if":null,"do":[{"do":"velocity","x":"0","y":null}]},
 {"when":{"on":"tick"},"state":"rest","if":"state_time > 1","do":[{"do":"state","name":"walk"}]}]}`,
  },
  {
    title: 'the player gets a jetpack with limited fuel shown on screen',
    json: `{"name":"Jetpack","description":"Hold Up to fly while fuel lasts; fuel refills on the ground.","vars":[{"name":"fuel","value":100}],"states":[],"handlers":[
 {"when":{"on":"key","key":"up","edge":"held"},"state":null,"if":"fuel > 0","do":[{"do":"velocity","x":null,"y":"max(self.vy - 1500 * dt, -220)"},{"do":"set","var":"fuel","value":"fuel - 60 * dt"}]},
 {"when":{"on":"tick"},"state":null,"if":"self.grounded and fuel < 100","do":[{"do":"set","var":"fuel","value":"min(100, fuel + 80 * dt)"}]},
 {"when":{"on":"every","seconds":0.5},"state":null,"if":"fuel < 100","do":[{"do":"message","text":"Fuel {round(fuel)}%","seconds":0.6}]}]}`,
  },
  {
    title: 'a platform that crumbles shortly after the player steps on it and comes back',
    json: `{"name":"Crumble","description":"Falls apart 0.6 s after the player lands on it; returns after 3 s.","vars":[],"states":["solid","shaking","gone"],"handlers":[
 {"when":{"on":"event","event":"touch_started","with":"player"},"state":"solid","if":null,"do":[{"do":"state","name":"shaking"}]},
 {"when":{"on":"tick"},"state":"shaking","if":null,"do":[{"do":"position","x":"self.spawn_x + sin(time * 60) * 1.5","y":"self.y"}]},
 {"when":{"on":"tick"},"state":"shaking","if":"state_time > 0.6","do":[{"do":"set_open","target":"self","open":"true"},{"do":"alpha","value":"0"},{"do":"state","name":"gone"}]},
 {"when":{"on":"tick"},"state":"gone","if":"state_time > 3","do":[{"do":"position","x":"self.spawn_x","y":"self.y"},{"do":"set_open","target":"self","open":"false"},{"do":"alpha","value":"1"},{"do":"state","name":"solid"}]}]}`,
  },
];
